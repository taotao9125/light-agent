import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { validatePathInCwd } from '../pathSafety.ts';
import { childSpawn } from './helper.ts';

import type { Tool } from '../tool.ts';

const rgBinaryPath = fileURLToPath(new URL('./rg', import.meta.url));
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 500;

const GREP_USAGE_HINT = [
	'[how]: grep 只能用于按已知线索定位文本位置，不用于浏览目录、读取文件或了解项目结构。',
	'- [good]: grep({ searchStrs: ["Tool_Calls"] })',
	'- [good]: grep({ searchStrs: ["Tool_Result", "tool_result"], scope: "packages/agent/src" })',
	'- [bad]: grep({ searchStrs: ["."] })',
	'- [bad]: grep({ searchStrs: ["packages/agent"] })',
].join('\n');

const grepSchema = z.object({
	searchStrs: z
		.array(
			z
				.string()
				.min(1)
				.describe(
					'要搜索的具体普通字符串，例如符号名、函数名、类型名、错误信息或文件内容片段。不要传正则、目录路径、文件路径、"."、".*"、".+" 或通配符。',
				),
		)
		.min(1)
		.max(10)
		.describe('要搜索的固定字符串列表。多个字符串表示分别搜索这些已知线索，grep 会合并返回匹配位置。'),
	scope: z
		.string()
		.optional()
		.describe(
			'可选搜索目录，必须是当前工作目录内的目录路径。不传时默认从 cwd 搜索。不要传文件路径；如果已经知道目标文件，请使用 read_file。',
		),
});

type RgMatchEvent = {
	type: 'match';
	data: {
		path: { text?: string };
		lines: { text: string };
		line_number: number;
	};
};

type GrepMatch = {
	path: string;
	line: number;
	content: string;
};

type SearchStrValidation = {
	validSearchStrs: string[];
	invalidSearchStrs: string[];
};

function isInvalidSearchStr(searchStr: string) {
	const normalized = searchStr.trim();
	if (!normalized) return true;

	const patterns = new Set(['.', '.*', '.+', '^.*$', '^.+$', '*']);
	if (patterns.has(normalized)) return true;

	return normalized.includes('/');
}

function partitionSearchStrs(searchStrs: string[]): SearchStrValidation {
	const validSearchStrs: string[] = [];
	const invalidSearchStrs: string[] = [];

	for (const searchStr of searchStrs) {
		if (isInvalidSearchStr(searchStr)) {
			invalidSearchStrs.push(searchStr);
			continue;
		}

		validSearchStrs.push(searchStr);
	}

	return { validSearchStrs, invalidSearchStrs };
}

function buildInvalidSearchStrsContent(invalidSearchStrs: string[]) {
	return [
		'[what]: grep searchStrs 全部无效，模型把目录、文件路径或通配搜索当成了要搜索的内容',
		'[invalid_searchStrs]:',
		...invalidSearchStrs.map((searchStr) => `- ${searchStr}`),
		GREP_USAGE_HINT,
	].join('\n');
}

function buildInvalidScopeContent(scope: string) {
	return [
		'[what]: grep scope 无效，scope 只支持当前工作目录内的目录路径，不支持文件路径',
		`[scope]: ${scope}`,
		'[how]: 如果你想了解目录结构，请使用 tree；如果你已经知道目标文件，请使用 read_file；如果还要在某个目录内定位文本线索，请把 scope 改成目录路径。',
	].join('\n');
}

function normalizeLine(text: string) {
	const line = text.replace(/\r?\n$/, '');
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}...[truncated]` : line;
}

function normalizePath(filePath: string) {
	return filePath.replace(/^\.\//, '');
}

function parseRgJson(stdout: string) {
	const matches: GrepMatch[] = [];
	let parseErrorCount = 0;

	for (const rawLine of stdout.split('\n')) {
		if (!rawLine.trim()) continue;

		let event: unknown;
		try {
			event = JSON.parse(rawLine);
		} catch {
			parseErrorCount++;
			continue;
		}

		if (!event || typeof event !== 'object' || (event as { type?: unknown }).type !== 'match') continue;

		const matchEvent = event as RgMatchEvent;
		const path = matchEvent.data.path.text;
		const line = matchEvent.data.line_number;
		const content = matchEvent.data.lines.text;
		if (!path || typeof line !== 'number') continue;

		matches.push({
			path: normalizePath(path),
			line,
			content: normalizeLine(content),
		});

		if (matches.length >= MAX_MATCHES) break;
	}

	return {
		matches,
		parseErrorCount,
		truncatedByMatches: matches.length >= MAX_MATCHES,
	};
}

function formatGrepMatches(input: {
	searchStrs: string[];
	invalidSearchStrs: string[];
	scope: string;
	matches: GrepMatch[];
	truncated: boolean;
	parseErrorCount: number;
}) {
	const lines = [
		'## grep 匹配结果',
		'',
		'Searched for:',
		...input.searchStrs.map((item) => `- \`${item}\``),
		'',
		`Scope: \`${input.scope}\``,
		'',
	];

	if (input.invalidSearchStrs.length > 0) {
		lines.push('[skipped_invalid_searchStrs]:');
		lines.push(...input.invalidSearchStrs.map((searchStr) => `- ${searchStr}`));
		lines.push('[why]: 这些字符串是空值、泛匹配、通配符、目录路径或文件路径，grep 没有搜索它们。');
		lines.push('');
	}

	for (const match of input.matches) {
		lines.push(`- ${match.path}:${match.line}`);
		lines.push(`  ${match.content}`);
	}

	if (input.truncated) {
		lines.push(
			'',
			'> 结果过多，已截断。请换用更具体的 searchStrs 或缩小 scope；如果是在探索项目结构，请使用 tree。',
		);
	}

	if (input.parseErrorCount > 0) {
		lines.push('', `> 有 ${input.parseErrorCount} 行 rg JSON 输出解析失败，已忽略。`);
	}

	return lines.join('\n');
}

function formatNoMatches(input: { searchStrs: string[]; invalidSearchStrs: string[]; scope: string }) {
	const lines = [
		'未找到匹配结果。',
		'',
		'Searched for:',
		...input.searchStrs.map((item) => `- \`${item}\``),
		'',
		`Scope: \`${input.scope}\``,
	];

	if (input.invalidSearchStrs.length > 0) {
		lines.push('');
		lines.push('[skipped_invalid_searchStrs]:');
		lines.push(...input.invalidSearchStrs.map((searchStr) => `- ${searchStr}`));
		lines.push('[why]: 这些字符串是空值、泛匹配、通配符、目录路径或文件路径，grep 没有搜索它们。');
	}

	return lines.join('\n');
}

function buildRgArgs(searchStrs: string[], searchPath: string) {
	// 内置 rg 15.1.0 不支持 --relative；这里传入相对 searchPath，让 JSON 结果保持 cwd 相对路径。
	const rgArgs = ['--json', '-I', '--line-number', '--glob=!.git/*', '--color', 'never', '--fixed-strings'];

	for (const searchStr of searchStrs) {
		rgArgs.push('-e', searchStr);
	}

	// -- 后面参数都按普通参数处理, 非命令行项
	rgArgs.push('--', searchPath);
	return rgArgs;
}

function dedupeMatches(matches: GrepMatch[]) {
	const seen = new Set<string>();
	const uniqueMatches: GrepMatch[] = [];

	for (const match of matches) {
		const key = `${match.path}:${match.line}:${match.content}`;
		if (seen.has(key)) continue;
		seen.add(key);
		uniqueMatches.push(match);
		if (uniqueMatches.length >= MAX_MATCHES) break;
	}

	return uniqueMatches;
}

function createGrepTool(): Tool.Definition<typeof grepSchema> {
	return {
		name: 'grep',
		description: [
			'[what] 在当前工作目录或指定目录内搜索一个或多个已知普通字符串，并返回匹配到的文件路径、行号和匹配行。grep 是发现工具，不是目录浏览工具，也不是文件读取工具。',
			'[args] searchStrs 是固定字符串数组；scope 是可选目录范围。不接收 path/glob/ignoreCase/fixedStrings，不支持文件级 scope。',
			'[note] searchStrs 会按固定字符串匹配；不要写正则。要找 class 定义时，搜索 "class " 这类普通文本片段。已经知道目标文件时使用 read_file。',
			GREP_USAGE_HINT,
		].join('\n'),
		schema: grepSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 grep。' };
			}

			context.signal?.throwIfAborted();

			const { validSearchStrs, invalidSearchStrs } = partitionSearchStrs(args.searchStrs);
			if (!validSearchStrs.length) {
				return { isError: true, content: buildInvalidSearchStrsContent(invalidSearchStrs) };
			}

			let searchPath = '.';
			if (args.scope) {
				const safePath = await validatePathInCwd(context.cwd, args.scope);
				if (!safePath.ok) {
					return { isError: true, content: safePath.content };
				}

				const scopeStat = await stat(safePath.path);
				if (!scopeStat.isDirectory()) {
					return { isError: true, content: buildInvalidScopeContent(args.scope) };
				}

				searchPath = safePath.relativePath || '.';
			}

			const result = await childSpawn({
				command: rgBinaryPath,
				args: buildRgArgs(validSearchStrs, searchPath),
				cwd: context.cwd,
				signal: context.signal,
				maxStdoutBytes: MAX_STDOUT_BYTES,
				maxStderrBytes: MAX_STDERR_BYTES,
			});

			if (result.aborted) {
				return { isError: true, content: 'grep 已取消。' };
			}

			if (result.timedOut) {
				return { isError: true, content: 'grep 执行超时，已终止。' };
			}

			if (result.code !== 0 && result.code !== 1) {
				return {
					isError: true,
					content: result.stderr.trim() || `rg 执行失败，退出码：${result.code}`,
				};
			}

			const parsed =
				result.code === 1
					? { matches: [], parseErrorCount: 0, truncatedByMatches: false }
					: parseRgJson(result.stdout);
			const matches = dedupeMatches(parsed.matches);
			if (!matches.length) {
				return {
					isError: false,
					content: formatNoMatches({
						searchStrs: validSearchStrs,
						invalidSearchStrs,
						scope: searchPath,
					}),
				};
			}

			const content = formatGrepMatches({
				searchStrs: validSearchStrs,
				invalidSearchStrs,
				scope: searchPath,
				matches,
				truncated:
					result.stdoutTruncated || parsed.truncatedByMatches || parsed.matches.length > matches.length,
				parseErrorCount: parsed.parseErrorCount,
			});

			return {
				isError: false,
				content,
			};
		},
	};
}

export default createGrepTool;
