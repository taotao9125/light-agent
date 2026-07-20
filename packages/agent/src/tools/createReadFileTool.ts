import { open, readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { validatePathInCwd } from '../pathSafety.ts';

import type { FileHandle } from 'node:fs/promises';
import type { Tool } from '../tool.ts';

const READ_SIZE_BYTES = 100 * 1024;
const IO_CHUNK_BYTES = 64 * 1024;
const BINARY_CHECK_BYTES = 8 * 1024;

/**
 * read_file 策略：
 * 1. 文件不超过预算时直接全量返回，让模型拿到完整上下文。
 * 2. 文件超过预算时，按有无线索选择起始行，再按完整行迭代返回窗口。
 * 3. 只有当前行本身超过预算时，才降级到 byteOffset；该参数必须来自工具返回的 next。
 */
const readFileSchema = z.object({
	path: z.string().min(1).describe('要读取的文件路径，必须在当前工作目录内。'),
	startLine: z.number().int().positive().optional().describe('开始行号，1-based。知道具体线索行时传入。'),
	endLine: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('结束行号，1-based，包含该行。只在需要读取明确范围时传入。'),
	byteOffset: z.number().int().nonnegative().optional().describe('只用于续读工具返回的超长单行 next；不要自行构造。'),
});

type FileLineInfo = {
	totalLines: number;
	startLineOffset?: number;
};

type LineRead = {
	text: string;
	bytes: number;
	reachedLineEnd: boolean;
	lineTooLong: boolean;
};

type WindowRead = {
	lines: Array<{ line: number; text: string }>;
	rangeStart: number;
	rangeEnd: number;
	complete: boolean;
	reason: string;
	next?: string;
};

function trimLineEnding(buffer: Buffer) {
	if (buffer.length > 0 && buffer[buffer.length - 1] === 0x0a) {
		const end = buffer.length > 1 && buffer[buffer.length - 2] === 0x0d ? buffer.length - 2 : buffer.length - 1;
		return buffer.subarray(0, end);
	}
	return buffer;
}

function splitTextLines(text: string) {
	if (!text) return [];
	const lines = text.split(/\r?\n/);
	if (text.endsWith('\n')) lines.pop();
	return lines;
}

function formatToolCall(args: { path: string; startLine?: number; endLine?: number; byteOffset?: number }) {
	const fields = [`path: ${JSON.stringify(args.path)}`];
	if (args.startLine !== undefined) fields.push(`startLine: ${args.startLine}`);
	if (args.endLine !== undefined) fields.push(`endLine: ${args.endLine}`);
	if (args.byteOffset !== undefined) fields.push(`byteOffset: ${args.byteOffset}`);
	return `read_file({ ${fields.join(', ')} })`;
}

function formatNumberedLines(lines: Array<{ line: number; text: string }>) {
	return lines.map((line) => `${line.line} | ${line.text}`).join('\n');
}

function formatReadResult(input: {
	path: string;
	sizeBytes: number;
	totalLines: number;
	complete: boolean;
	range?: string;
	reason: string;
	content: string;
	next?: string;
	hint?: string;
}) {
	return [
		'[what]: file_content',
		`[path]: ${input.path}`,
		`[size_bytes]: ${input.sizeBytes}`,
		`[total_lines]: ${input.totalLines}`,
		`[complete]: ${input.complete}`,
		input.range ? `[range]: ${input.range}` : undefined,
		`[reason]: ${input.reason}`,
		'[content]:',
		input.content,
		input.next ? `[next]: ${input.next}` : undefined,
		input.hint ? `[hint]: ${input.hint}` : undefined,
	]
		.filter((line): line is string => line !== undefined)
		.join('\n');
}

function formatRangeError(lines: string[]) {
	return {
		isError: true,
		content: lines.join('\n'),
	};
}

async function hasBinaryMarker(filePath: string, fileSize: number) {
	if (fileSize === 0) return false;

	const file = await open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(Math.min(BINARY_CHECK_BYTES, fileSize));
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		return buffer.subarray(0, bytesRead).includes(0);
	} finally {
		await file.close();
	}
}

async function inspectFileLines(filePath: string, startLine: number, fileSize: number): Promise<FileLineInfo> {
	if (fileSize === 0) return { totalLines: 0 };

	const file = await open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(IO_CHUNK_BYTES);
		let position = 0;
		let currentLine = 1;
		let currentLineOffset = 0;
		let newlineCount = 0;
		let lastByteWasNewline = false;
		let startLineOffset: number | undefined = startLine === 1 ? 0 : undefined;

		while (position < fileSize) {
			const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, fileSize - position), position);
			if (bytesRead === 0) break;

			for (let index = 0; index < bytesRead; index++) {
				const byte = buffer[index];
				const absoluteOffset = position + index;
				lastByteWasNewline = byte === 0x0a;

				if (byte === 0x0a) {
					newlineCount++;
					currentLine++;
					currentLineOffset = absoluteOffset + 1;
					if (currentLine === startLine && startLineOffset === undefined) {
						startLineOffset = currentLineOffset;
					}
				}
			}

			position += bytesRead;
		}

		return {
			totalLines: newlineCount + (lastByteWasNewline ? 0 : 1),
			startLineOffset,
		};
	} finally {
		await file.close();
	}
}

async function readLineByteLength(filePath: string, lineStartOffset: number, fileSize: number) {
	const file = await open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(IO_CHUNK_BYTES);
		let position = lineStartOffset;

		while (position < fileSize) {
			const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, fileSize - position), position);
			if (bytesRead === 0) break;

			const chunk = buffer.subarray(0, bytesRead);
			const newlineIndex = chunk.indexOf(0x0a);
			if (newlineIndex >= 0) {
				const lineEndOffset = position + newlineIndex;
				return lineEndOffset > lineStartOffset && buffer[newlineIndex - 1] === 0x0d
					? lineEndOffset - lineStartOffset - 1
					: lineEndOffset - lineStartOffset;
			}

			position += bytesRead;
		}

		return fileSize - lineStartOffset;
	} finally {
		await file.close();
	}
}

async function readLine(file: FileHandle, offset: number, maxBytes: number, fileSize: number): Promise<LineRead> {
	const chunks: Buffer[] = [];
	let position = offset;
	let bytes = 0;

	while (position < fileSize && bytes <= maxBytes) {
		const chunkSize = Math.min(IO_CHUNK_BYTES, fileSize - position, maxBytes + 1 - bytes);
		const buffer = Buffer.alloc(chunkSize);
		const { bytesRead } = await file.read(buffer, 0, chunkSize, position);
		if (bytesRead === 0) break;

		const chunk = buffer.subarray(0, bytesRead);
		const newlineIndex = chunk.indexOf(0x0a);
		if (newlineIndex >= 0) {
			const visible = chunk.subarray(0, newlineIndex + 1);
			chunks.push(visible);
			bytes += visible.length;
			return {
				text: trimLineEnding(Buffer.concat(chunks)).toString('utf8'),
				bytes,
				reachedLineEnd: true,
				lineTooLong: false,
			};
		}

		chunks.push(chunk);
		bytes += chunk.length;
		position += bytesRead;
	}

	const lineTooLong = bytes > maxBytes;
	const visible = lineTooLong ? Buffer.concat(chunks).subarray(0, maxBytes) : Buffer.concat(chunks);

	return {
		text: trimLineEnding(visible).toString('utf8'),
		bytes: visible.length,
		reachedLineEnd: !lineTooLong,
		lineTooLong,
	};
}

async function readLineWindow(input: {
	filePath: string;
	fileSize: number;
	path: string;
	startLine: number;
	endLine?: number;
	startLineOffset: number;
	totalLines: number;
}) {
	const file = await open(input.filePath, 'r');
	try {
		const lines: WindowRead['lines'] = [];
		let currentLine = input.startLine;
		let currentOffset = input.startLineOffset;
		let usedBytes = 0;
		let next: string | undefined;
		let reason = '文件超过全量读取阈值，已按行返回当前窗口。';

		// 行窗口优先保留完整行；预算不足时在行边界停止，并把下一行交给 next。
		while (currentLine <= input.totalLines && (input.endLine === undefined || currentLine <= input.endLine)) {
			const line = await readLine(file, currentOffset, READ_SIZE_BYTES, input.fileSize);

			if (line.lineTooLong) {
				if (lines.length === 0) {
					return await readLongLineWindow({
						file,
						fileSize: input.fileSize,
						path: input.path,
						startLine: currentLine,
						lineStartOffset: currentOffset,
						totalLines: input.totalLines,
						byteOffset: 0,
						endLine: input.endLine,
					});
				}

				next = formatToolCall({ path: input.path, startLine: currentLine, endLine: input.endLine });
				reason = '下一个目标行超过读取预算，已在该行前停止；继续读取会进入 byteOffset 窗口。';
				break;
			}

			if (lines.length > 0 && usedBytes + line.bytes > READ_SIZE_BYTES) {
				next = formatToolCall({ path: input.path, startLine: currentLine, endLine: input.endLine });
				break;
			}

			lines.push({ line: currentLine, text: line.text });
			usedBytes += line.bytes;
			currentOffset += line.bytes;
			currentLine++;
		}

		if (!next && currentLine <= input.totalLines && (input.endLine === undefined || currentLine <= input.endLine)) {
			next = formatToolCall({ path: input.path, startLine: currentLine, endLine: input.endLine });
		}

		const rangeStart = lines[0]?.line ?? input.startLine;
		const rangeEnd = lines.at(-1)?.line ?? input.startLine;

		return {
			lines,
			rangeStart,
			rangeEnd,
			complete: !next && input.endLine === undefined && currentLine > input.totalLines,
			reason,
			next,
		};
	} finally {
		await file.close();
	}
}

async function readLongLineWindow(input: {
	file: FileHandle;
	fileSize: number;
	path: string;
	startLine: number;
	lineStartOffset: number;
	totalLines: number;
	byteOffset: number;
	endLine?: number;
}): Promise<WindowRead> {
	const absoluteOffset = input.lineStartOffset + input.byteOffset;
	const line = await readLine(input.file, absoluteOffset, READ_SIZE_BYTES, input.fileSize);
	// 超长单行只能按 byteOffset 分段；读完整行后回到行模式继续下一行。
	const next = line.reachedLineEnd
		? input.startLine < input.totalLines && (input.endLine === undefined || input.startLine < input.endLine)
			? formatToolCall({ path: input.path, startLine: input.startLine + 1, endLine: input.endLine })
			: undefined
		: formatToolCall({
				path: input.path,
				startLine: input.startLine,
				endLine: input.startLine,
				byteOffset: input.byteOffset + line.bytes,
			});

	return {
		lines: [{ line: input.startLine, text: line.text }],
		rangeStart: input.startLine,
		rangeEnd: input.startLine,
		complete: !next && input.endLine === undefined && input.startLine >= input.totalLines,
		reason: line.reachedLineEnd
			? '超长单行已读完，下一次会回到行读取模式。'
			: '当前行超过读取预算，已按 byteOffset 返回该行窗口。',
		next,
	};
}

async function readLongLineFromOffset(input: {
	filePath: string;
	fileSize: number;
	path: string;
	startLine: number;
	endLine?: number;
	byteOffset: number;
	totalLines: number;
}) {
	const lineInfo = await inspectFileLines(input.filePath, input.startLine, input.fileSize);
	if (lineInfo.startLineOffset === undefined) {
		return formatRangeError([
			'[what]: 无法定位 byteOffset 对应的行',
			`[path]: ${input.path}`,
			`[startLine]: ${input.startLine}`,
			`[total_lines]: ${input.totalLines}`,
			'[how]: 请重新选择有效行号，或先读取文件开头确认范围。',
		]);
	}

	const lineByteLength = await readLineByteLength(input.filePath, lineInfo.startLineOffset, input.fileSize);
	if (input.byteOffset >= lineByteLength) {
		return formatRangeError([
			'[what]: read_file byteOffset 超出当前行长度',
			`[path]: ${input.path}`,
			`[startLine]: ${input.startLine}`,
			`[byteOffset]: ${input.byteOffset}`,
			`[line_bytes]: ${lineByteLength}`,
			'[how]: byteOffset 只能照抄工具上一次返回的 next；如果该行已读完，请继续读取下一行。',
		]);
	}

	const file = await open(input.filePath, 'r');
	try {
		const window = await readLongLineWindow({
			file,
			fileSize: input.fileSize,
			path: input.path,
			startLine: input.startLine,
			lineStartOffset: lineInfo.startLineOffset,
			totalLines: input.totalLines,
			byteOffset: input.byteOffset,
			endLine: input.endLine,
		});

		return {
			isError: false,
			content: formatReadResult({
				path: input.path,
				sizeBytes: input.fileSize,
				totalLines: input.totalLines,
				complete: window.complete,
				range: `${window.rangeStart}-${window.rangeEnd}`,
				reason: window.reason,
				content: formatNumberedLines(window.lines),
				next: window.next,
			}),
		};
	} finally {
		await file.close();
	}
}

function createReadFileTool(): Tool.Definition<typeof readFileSchema> {
	return {
		name: 'read_file',
		description: [
			'读取当前工作目录内的文本文件内容。小文件会完整返回；大文件按行窗口读取；只有超长单行才使用 byteOffset 续读。',
			'无线索时只传 path；有 grep、错误栈或用户指定行号时传 startLine，可选 endLine；byteOffset 只照抄工具返回的 next。',
		].join('\n'),
		schema: readFileSchema,
		async execute(args, context) {
			if (!context) {
				return { isError: true, content: '工具运行时上下文不存在，无法执行 read_file。' };
			}

			context.signal?.throwIfAborted();

			const safePath = await validatePathInCwd(context.cwd, args.path);
			if (!safePath.ok) {
				return { isError: true, content: safePath.content };
			}

			const fileStat = await stat(safePath.path);
			if (fileStat.isDirectory()) {
				return {
					isError: true,
					content: [
						'[what]: 你传入的是目录，不是文件，read_file 无法读取目录内容',
						`[path]: ${args.path}`,
						'[how]: 请传入具体文件路径；如果不确定文件位置，请先用 list_project_files_tree 查看目录结构，或用 grep 搜索具体文本线索。',
					].join('\n'),
				};
			}

			const path = safePath.relativePath || '.';
			if (args.startLine !== undefined && args.endLine !== undefined && args.startLine > args.endLine) {
				return formatRangeError([
					'[what]: read_file 行号范围无效',
					`[path]: ${path}`,
					`[startLine]: ${args.startLine}`,
					`[endLine]: ${args.endLine}`,
					'[how]: startLine 必须小于或等于 endLine，请重新选择有效范围。',
				]);
			}

			if (args.byteOffset !== undefined && (args.startLine === undefined || args.endLine === undefined)) {
				return formatRangeError([
					'[what]: read_file byteOffset 参数无效',
					`[path]: ${path}`,
					'[how]: byteOffset 只能用于续读超长单行，必须同时传入 startLine 和 endLine。',
				]);
			}

			if (args.byteOffset !== undefined && args.startLine !== args.endLine) {
				return formatRangeError([
					'[what]: read_file byteOffset 参数无效',
					`[path]: ${path}`,
					`[startLine]: ${args.startLine}`,
					`[endLine]: ${args.endLine}`,
					'[how]: byteOffset 只能用于单行续读，要求 startLine === endLine。',
				]);
			}

			if (await hasBinaryMarker(safePath.path, fileStat.size)) {
				return {
					isError: true,
					content: [
						'[what]: 目标文件看起来是二进制文件，read_file 当前暂不支持读取二进制文件',
						`[path]: ${path}`,
						`[size_bytes]: ${fileStat.size}`,
						'[how]: 请重新选择文本文件路径；如果必须处理该二进制文件，请向用户说明当前工具暂不支持。',
					].join('\n'),
				};
			}

			// 小文件优先全量读；即使模型传了行号，也不给它裁掉上下文。
			if (fileStat.size <= READ_SIZE_BYTES) {
				const content = await readFile(safePath.path, 'utf8');
				const lines = splitTextLines(content).map((text, index) => ({ line: index + 1, text }));
				const totalLines = lines.length;

				return {
					isError: false,
					content: formatReadResult({
						path,
						sizeBytes: fileStat.size,
						totalLines,
						complete: true,
						range: totalLines > 0 ? `1-${totalLines}` : undefined,
						reason: '文件未超过全量读取阈值，已返回完整文件内容。',
						content: formatNumberedLines(lines),
					}),
				};
			}

			const startLine = args.startLine ?? 1;
			const lineInfo = await inspectFileLines(safePath.path, startLine, fileStat.size);
			if (startLine > lineInfo.totalLines) {
				return formatRangeError([
					'[what]: read_file startLine 超出文件总行数',
					`[path]: ${path}`,
					`[startLine]: ${startLine}`,
					`[total_lines]: ${lineInfo.totalLines}`,
					'[how]: 请根据 total_lines 选择有效行号；如果不确定内容位置，请先用 grep 定位。',
				]);
			}

			if (args.byteOffset !== undefined) {
				return await readLongLineFromOffset({
					filePath: safePath.path,
					fileSize: fileStat.size,
					path,
					startLine,
					endLine: args.endLine,
					byteOffset: args.byteOffset,
					totalLines: lineInfo.totalLines,
				});
			}

			const window = await readLineWindow({
				filePath: safePath.path,
				fileSize: fileStat.size,
				path,
				startLine,
				endLine: args.endLine,
				startLineOffset: lineInfo.startLineOffset ?? 0,
				totalLines: lineInfo.totalLines,
			});

			return {
				isError: false,
				content: formatReadResult({
					path,
					sizeBytes: fileStat.size,
					totalLines: lineInfo.totalLines,
					complete: window.complete,
					range: `${window.rangeStart}-${window.rangeEnd}`,
					reason: window.reason,
					content: formatNumberedLines(window.lines),
					next: window.next,
					hint:
						args.startLine === undefined
							? '如果要找具体符号、关键词或错误文本，请先用 grep 定位，再按 startLine 读取。'
							: undefined,
				}),
			};
		},
	};
}

export default createReadFileTool;
