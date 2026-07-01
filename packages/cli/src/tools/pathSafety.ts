import path from 'node:path';

export type ResolvedWorkspacePath =
	| { ok: true; absolutePath: string; workspaceRoot: string; relativePath: string }
	| { ok: false; reason: string };

function normalizeForCheck(relativePath: string) {
	return relativePath.replace(/\\/g, '/');
}

export function isBlockedToolPath(relativePath: string) {
	const normalized = normalizeForCheck(relativePath);
	const segments = normalized.split('/').filter(Boolean);

	if (segments.includes('.git')) {
		return true;
	}

	return false;
}

export function getWorkspaceRoot(cwd = process.cwd()) {
	return process.env.AGENT_WORKSPACE ? path.resolve(process.env.AGENT_WORKSPACE) : path.resolve(cwd);
}

export function resolveWorkspacePath(relativePath: string, cwd = process.cwd()): ResolvedWorkspacePath {
	const trimmed = relativePath?.trim();
	if (!trimmed) {
		return { ok: false, reason: 'Path is required.' };
	}

	const workspaceRoot = getWorkspaceRoot(cwd);

	const absolutePath = path.resolve(workspaceRoot, trimmed);
	const relativeToRoot = path.relative(workspaceRoot, absolutePath);

	if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
		return {
			ok: false,
			reason: `Path must stay within workspace: ${workspaceRoot}`,
		};
	}

	if (isBlockedToolPath(relativeToRoot)) {
		return {
			ok: false,
			reason: 'Writes to .git are not allowed.',
		};
	}

	return {
		ok: true,
		absolutePath,
		workspaceRoot,
		relativePath: relativeToRoot || '.',
	};
}
