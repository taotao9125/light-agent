import { describe, expect, it } from 'vitest';
import { childSpawn } from '../../tools/helper.ts';

describe('childSpawn', () => {
	it('应执行命令并收集输出', async () => {
		const result = await childSpawn({
			command: process.execPath,
			args: ['-e', 'process.stdout.write("hello")'],
			cwd: process.cwd(),
		});

		expect(result).toMatchObject({
			code: 0,
			stdout: 'hello',
			stderr: '',
			stdoutTruncated: false,
			stderrTruncated: false,
			timedOut: false,
			aborted: false,
		});
	});

	it('应保留非零退出码和 stderr', async () => {
		const result = await childSpawn({
			command: process.execPath,
			args: ['-e', 'process.stderr.write("bad"); process.exit(7)'],
			cwd: process.cwd(),
		});

		expect(result.code).toBe(7);
		expect(result.stderr).toBe('bad');
	});

	it('应限制 stdout 大小并标记截断', async () => {
		const result = await childSpawn({
			command: process.execPath,
			args: ['-e', 'process.stdout.write("abcdef")'],
			cwd: process.cwd(),
			maxStdoutBytes: 3,
		});

		expect(result.stdout).toBe('abc');
		expect(result.stdoutTruncated).toBe(true);
	});
});
