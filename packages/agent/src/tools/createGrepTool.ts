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
	'[how]: grep 只能用于按已知线索定位文本位置，不用于浏览目录或了解项目结构。',
	'[good]: grep({ pattern: "Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id", path: "packages" })',
	'[bad]: grep({ pattern: ".", path: "." })',
	'[bad]: grep({ pattern: "./packages", path: "." })',
].join('\n');

const grepSchema = z.object({
	pattern: z
		.string()
		.min(1)
		.describe(
			'要定位的具体关键词、符号名、函数名、类型名、错误信息、文件内容片段或正则表达式。pattern 是要搜索的内容，不是目录路径；必须已经知道明确线索时才填写。正确示例："Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id"。不要传 "."、"./packages"、".*"、".+"、空白或只包含通配符的表达式。',
		),
	path: z.string().default('.').describe('搜索范围。必须是 cwd 内的相对路径；已知大致目录时应优先缩小到具体目录。'),
	glob: z.string().optional().describe('文件过滤，例如 "*.ts"、"src/**/*.ts"；已知文件类型时应填写。'),
	ignoreCase: z.boolean().default(false).describe('是否忽略大小写。'),
	fixedStrings: z.boolean().default(false).describe('是否按普通字符串搜索，而不是正则表达式。'),
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

function isUselessPattern(pattern: string) {
	const normalized = pattern.trim();
	if (!normalized) return true;

	const patterns = new Set(['.', '.*', '.+', '^.*$', '^.+$', '*']);
	if (patterns.has(normalized)) return true;

	return /^\.?\.?\//.test(normalized);
}

function buildInvalidPatternContent(pattern: string) {
	return [
		'[what]: grep pattern 无效，模型把目录/通配搜索当成了要搜索的内容',
		`[pattern]: ${pattern}`,
		GREP_USAGE_HINT,
	].join('\n');
}

function normalizeLine(text: string) {
	const line = text.replace(/\r?\n$/, '');
	return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}...[truncated]` : line;
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
			path,
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
	pattern: string;
	path: string;
	matches: GrepMatch[];
	truncated: boolean;
	parseErrorCount: number;
}) {
	const lines = ['## grep 匹配结果', '', `Searched for \`${input.pattern}\` in \`${input.path}\`.`, ''];

	for (const match of input.matches) {
		lines.push(`- ${match.path}:${match.line}`);
		lines.push(`  ${match.content}`);
	}

	if (input.truncated) {
		lines.push('', '> 结果过多，已截断。请缩小 path、glob 或 pattern 后重新搜索。');
	}

	if (input.parseErrorCount > 0) {
		lines.push('', `> 有 ${input.parseErrorCount} 行 rg JSON 输出解析失败，已忽略。`);
	}

	return lines.join('\n');
}

function buildRgArgs(args: z.infer<typeof grepSchema>, searchPath: string) {
	// 内置 rg 15.1.0 不支持 --relative；这里传入相对 searchPath，让 JSON 结果保持 cwd 相对路径。
	const rgArgs = ['--json', '--line-number', '--glob=!.git/*', '--color', 'never'];

	if (args.ignoreCase) rgArgs.push('--ignore-case');
	if (args.fixedStrings) rgArgs.push('--fixed-strings');
	if (args.glob) rgArgs.push('--glob', args.glob);

	rgArgs.push('--', args.pattern, searchPath);
	return rgArgs;
}

function createGrepTool(): Tool.Definition<typeof grepSchema> {
	return {
		name: 'grep',
		description:
			'在当前工作目录内定位已知关键词、符号名、错误信息或具体文本出现的位置。只有当你已经知道要搜索的具体字符串或正则时才使用 grep。不要用 grep 浏览项目、列目录、读取文件、搜索所有内容，尤其不要使用 "."、"./packages"、".*" 这类目录或泛匹配 pattern。grep 的正确用法类似：Searched for Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id in packages。grep 的结果只用于获得文件路径、行号和匹配行；需要阅读上下文时继续调用 read_file。',
		schema: grepSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 grep。' };
			}

			context.signal?.throwIfAborted();

			if (isUselessPattern(args.pattern)) {
				return { isError: true, content: buildInvalidPatternContent(args.pattern) };
			}

			const safePath = await validatePathInCwd(context.cwd, args.path);
			if (!safePath.ok) {
				return { isError: true, content: safePath.content };
			}

			const searchPath = safePath.relativePath || '.';
			const result = await childSpawn({
				command: rgBinaryPath,
				args: buildRgArgs(args, searchPath),
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

			if (result.code === 1) {
				return { isError: false, content: '未找到匹配结果。' };
			}

			if (result.code !== 0) {
				return {
					isError: true,
					content: result.stderr.trim() || `rg 执行失败，退出码：${result.code}`,
				};
			}

			const parsed = parseRgJson(result.stdout);
			const content = formatGrepMatches({
				pattern: args.pattern,
				path: searchPath,
				matches: parsed.matches,
				truncated: result.stdoutTruncated || parsed.truncatedByMatches,
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
