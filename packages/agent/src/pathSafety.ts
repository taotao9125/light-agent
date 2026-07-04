import { access, realpath } from 'node:fs/promises';
import path from 'node:path';

export type SafePathResult =
	| {
			ok: true;
			cwd: string;
			path: string;
			relativePath: string;
	  }
	| {
			ok: false;
			reason: 'path_escape' | 'path_not_found';
			content: string;
	  };

export async function validatePathInCwd(cwd: string, inputPath: string): Promise<SafePathResult> {
	const realCwd = await realpath(cwd);
	const resolvedPath = path.resolve(realCwd, inputPath);

	try {
		await access(resolvedPath);
	} catch {
		return {
			ok: false,
			reason: 'path_not_found',
			content: [
				'[what]: 你传入的路径不存在，工具无法执行',
				`[cwd]: ${realCwd}`,
				`[path]: ${inputPath}`,
				'[how]: 请确认路径拼写，或先搜索/查看当前工作目录内存在的路径后再调用工具。',
			].join('\n'),
		};
	}

	const realTargetPath = await realpath(resolvedPath);
	const relativePath = path.relative(realCwd, realTargetPath);

	if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
		return {
			ok: true,
			cwd: realCwd,
			path: realTargetPath,
			relativePath,
		};
	}

	return {
		ok: false,
		reason: 'path_escape',
		content: [
			'[what]: 你传入的路径不在当前工作目录内，工具已拒绝执行',
			`[cwd]: ${realCwd}`,
			`[path]: ${inputPath}`,
			'[how]: 请重新选择当前工作目录内的相对路径或子目录后再调用工具。',
		].join('\n'),
	};
}
