import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePathInCwd } from '../pathSafety.ts';

async function createWorkspace() {
	const root = await mkdtemp(join(tmpdir(), 'light-agent-path-'));
	const outside = await mkdtemp(join(tmpdir(), 'light-agent-outside-'));
	await mkdir(join(root, 'src'));
	await writeFile(join(root, 'src', 'app.ts'), 'console.log("ok");');
	await writeFile(join(outside, 'secret.txt'), 'secret');
	await symlink(join(outside, 'secret.txt'), join(root, 'src', 'secret-link.txt'));
	return { root, outside };
}

describe('validatePathInCwd', () => {
	it('应允许 cwd 内路径', async () => {
		const { root } = await createWorkspace();

		const result = await validatePathInCwd(root, 'src/app.ts');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.relativePath).toBe('src/app.ts');
			expect(result.path.endsWith('src/app.ts')).toBe(true);
		}
	});

	it('应拒绝 .. 路径逃逸', async () => {
		const { root } = await createWorkspace();

		const result = await validatePathInCwd(root, '..');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('path_escape');
			expect(result.content).toContain('[what]: 你传入的路径不在当前工作目录内');
		}
	});

	it('应拒绝 symlink 指向 cwd 外部', async () => {
		const { root } = await createWorkspace();

		const result = await validatePathInCwd(root, 'src/secret-link.txt');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('path_escape');
		}
	});

	it('应返回不存在路径的可读错误', async () => {
		const { root } = await createWorkspace();

		const result = await validatePathInCwd(root, 'missing.ts');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('path_not_found');
			expect(result.content).toContain('[what]: 你传入的路径不存在');
		}
	});
});
