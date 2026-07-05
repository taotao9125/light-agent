import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { childSpawn } from './helper.ts';

import type { Tool } from '../tool.ts';

const rgBinaryPath = fileURLToPath(new URL('./rg', import.meta.url));
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_MATCHES = 100;
const MAX_LINE_CHARS = 500;

const GREP_USAGE_HINT = [
	'[how]: grep 只能用于按已知线索定位文本位置，不用于浏览目录或了解项目结构。',
	'- [good]: grep({ searchStr: "Tool_Calls|Tool_Results|tool_call|tool_calls|tool_result|tool_call_id" })',
	'- [bad]: grep({ searchStr: "." })',
	'- [bad]: grep({ searchStr: "packages/agent" })',
].join('\n');

const grepSchema = z.object({
	searchStr: z
		.string()
		.min(1)
		.describe(
			'要搜索的具体字符串或正则表达式，例如符号名、函数名、类型名、错误信息或文件内容片段。不要传目录路径、文件路径、"."、".*"、".+"、空白或只包含通配符的表达式。',
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

function isInvalidSearchStr(searchStr: string) {
	const normalized = searchStr.trim();
	if (!normalized) return true;

	const patterns = new Set(['.', '.*', '.+', '^.*$', '^.+$', '*']);
	if (patterns.has(normalized)) return true;

	return normalized.includes('/') && !/[|()[\]{}+?^$\\]/.test(normalized);
}

function buildInvalidSearchStrContent(searchStr: string) {
	return [
		'[what]: grep searchStr 无效，模型把目录、文件路径或通配搜索当成了要搜索的内容',
		`[searchStr]: ${searchStr}`,
		GREP_USAGE_HINT,
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
	searchStr: string;
	matches: GrepMatch[];
	truncated: boolean;
	parseErrorCount: number;
}) {
	const lines = ['## grep 匹配结果', '', `Searched for \`${input.searchStr}\`.`, ''];

	for (const match of input.matches) {
		lines.push(`- ${match.path}:${match.line}`);
		lines.push(`  ${match.content}`);
	}

	if (input.truncated) {
		lines.push(
			'',
			'> 结果过多，已截断。请换用更具体的 searchStr；如果是在探索项目结构，请使用 list_project_files_tree。',
		);
	}

	if (input.parseErrorCount > 0) {
		lines.push('', `> 有 ${input.parseErrorCount} 行 rg JSON 输出解析失败，已忽略。`);
	}

	return lines.join('\n');
}

function buildRgArgs(args: z.infer<typeof grepSchema>, searchPath: string) {
	// 内置 rg 15.1.0 不支持 --relative；这里传入相对 searchPath，让 JSON 结果保持 cwd 相对路径。
	const rgArgs = ['--json', '-I', '--line-number', '--glob=!.git/*', '--color', 'never'];

	// -- 后面参数都当走普通参数处理, 非命令行项
	rgArgs.push('--', args.searchStr, searchPath);
	return rgArgs;
}

function createGrepTool(): Tool.Definition<typeof grepSchema> {
	return {
		name: 'grep',
		description:
			[
				'[what] 在当前工作目录内搜索一个已知字符串或正则表达式，并返回匹配到的文件路径、行号和匹配行。grep 只有一个参数 searchStr；它不是目录浏览工具，不接收 path/glob/ignoreCase/fixedStrings。需要探索项目目录结构时使用 list_project_files_tree；需要读取文件时使用 read_file。',
				GREP_USAGE_HINT
			].join('\n'),
		schema: grepSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 grep。' };
			}

			context.signal?.throwIfAborted();

			if (isInvalidSearchStr(args.searchStr)) {
				return { isError: true, content: buildInvalidSearchStrContent(args.searchStr) };
			}

			const result = await childSpawn({
				command: rgBinaryPath,
				args: buildRgArgs(args, '.'),
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
				searchStr: args.searchStr,
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
