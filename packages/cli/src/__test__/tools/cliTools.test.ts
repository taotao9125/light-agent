import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import grepTool from '../../tools/grep.ts';
import { getWorkspaceRoot, isBlockedToolPath, resolveWorkspacePath } from '../../tools/pathSafety.ts';
import readFileTool from '../../tools/readFile.ts';
import runCommandTool, { parseCommandLine, validateRunCommand } from '../../tools/runCommand.ts';
import writeFileTool from '../../tools/writeFile.ts';

describe('pathSafety', () => {
	const previousWorkspace = process.env.AGENT_WORKSPACE;

	afterEach(() => {
		if (previousWorkspace === undefined) {
			delete process.env.AGENT_WORKSPACE;
		} else {
			process.env.AGENT_WORKSPACE = previousWorkspace;
		}
	});

	it('应拒绝逃出 workspace 的路径', () => {
		const resolved = resolveWorkspacePath('../outside.txt', '/tmp/agent-workspace');
		expect(resolved.ok).toBe(false);
	});

	it('应拒绝 .git 路径', () => {
		expect(isBlockedToolPath('.git/config')).toBe(true);
		expect(resolveWorkspacePath('.git/config', '/tmp/agent-workspace').ok).toBe(false);
	});

	it('AGENT_WORKSPACE 应作为根目录', () => {
		process.env.AGENT_WORKSPACE = '/tmp/eval-workspace';
		expect(getWorkspaceRoot('/ignored')).toBe(path.resolve('/tmp/eval-workspace'));
	});
});

describe('write_file / read_file', () => {
	it('应能在 workspace 内写入并读回', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-tool-'));
		process.env.AGENT_WORKSPACE = workspace;

		const targetPath = 'nested/hello.txt';
		const content = 'hello eval workspace';

		const writeResult = await writeFileTool.execute({ path: targetPath, content, _intent: 'create test file' }, {});
		expect(writeResult.isError).toBe(false);

		const readResult = await readFileTool.execute({ path: targetPath, _intent: 'verify test file' }, {});
		expect(readResult.isError).toBe(false);
		expect(readResult.content).toContain(content);

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});
});

describe('grep', () => {
	it('应能搜索正文和文件路径', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-grep-'));
		process.env.AGENT_WORKSPACE = workspace;

		await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
		await fs.writeFile(path.join(workspace, 'src', 'alpha.ts'), 'export const marker = "contextBuilder";\n');
		await fs.writeFile(path.join(workspace, 'src', 'beta.md'), '# beta\n');

		const contentResult = await grepTool.execute(
			{ mode: 'content', query: 'contextBuilder', path: 'src', _intent: 'search content' },
			{},
		);
		expect(contentResult.isError).toBe(false);
		expect(contentResult.content).toContain('src/alpha.ts');

		const filesResult = await grepTool.execute(
			{ mode: 'files', query: 'alpha', glob: '**/*.ts', _intent: 'find file path' },
			{},
		);
		expect(filesResult.isError).toBe(false);
		expect(filesResult.content).toContain('src/alpha.ts');
		expect(filesResult.content).not.toContain('src/beta.md');

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});

	it('应拒绝 workspace 外路径', async () => {
		const result = await grepTool.execute({ mode: 'files', path: '../outside', _intent: 'verify path safety' }, {});
		expect(result.isError).toBe(true);
	});
});

describe('run_command validation', () => {
	it('应解析带引号的命令', () => {
		expect(parseCommandLine('npm install "foo bar"')).toEqual(['npm', 'install', 'foo bar']);
	});

	it('应允许安全 shell 操作符并拒绝危险片段', () => {
		expect(validateRunCommand('npm install && rm -rf /').ok).toBe(false);
		expect(validateRunCommand('npm install; echo done').ok).toBe(true);
		expect(validateRunCommand('find src -name *.ts > out.txt').ok).toBe(true);
		expect(validateRunCommand('pnpm run dev --host').ok).toBe(true);
	});

	it('应允许只读 pipeline 与 2>/dev/null', () => {
		expect(validateRunCommand('find src -name *.ts | wc -l').ok).toBe(true);
		expect(
			validateRunCommand("find src -name *.ts ! -name *.test.ts ! -path '*/test/*' 2>/dev/null | wc -l").ok,
		).toBe(true);
		expect(validateRunCommand('rg contextBuilder agent/src | head -n 5').ok).toBe(true);
		expect(validateRunCommand('find src -name *.ts | wc -l | rm -rf').ok).toBe(false);
	});

	it('应允许常规 shell 命令', () => {
		expect(validateRunCommand('python script.py').ok).toBe(true);
		expect(validateRunCommand('npm run build').ok).toBe(true);
		expect(validateRunCommand('git status').ok).toBe(true);
		expect(validateRunCommand('rg contextBuilder agent/src').ok).toBe(true);
	});

	it('应允许 install / create 等包管理器命令', () => {
		expect(validateRunCommand('npm install').ok).toBe(true);
		expect(validateRunCommand('npm ci').ok).toBe(true);
		expect(validateRunCommand('pnpm add react').ok).toBe(true);
		expect(validateRunCommand('pnpm install --frozen-lockfile').ok).toBe(true);
		expect(validateRunCommand('npm create vite@latest todo-demo -- --template react-ts').ok).toBe(true);
		expect(validateRunCommand('npx create-vite todo-demo --template react-ts').ok).toBe(true);
	});

	it('应拒绝删除和写入型 shell/git 操作', () => {
		expect(validateRunCommand('rm -rf src').ok).toBe(false);
		expect(validateRunCommand('rmdir tmp').ok).toBe(false);
		expect(validateRunCommand('mv a b').ok).toBe(false);
		expect(validateRunCommand('find . -delete').ok).toBe(false);
		expect(validateRunCommand('sed -i s/a/b/g file.txt').ok).toBe(false);
		expect(validateRunCommand('git clean -fd').ok).toBe(false);
		expect(validateRunCommand('git reset --hard').ok).toBe(false);
		expect(validateRunCommand('git add src/index.ts').ok).toBe(false);
		expect(validateRunCommand('git diff').ok).toBe(true);
	});
});

describe('run_command execute', () => {
	it('应在 workspace 内执行 npm 命令', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-run-'));
		process.env.AGENT_WORKSPACE = workspace;

		await fs.writeFile(
			path.join(workspace, 'package.json'),
			JSON.stringify({ name: 'run-command-test', private: true }, null, 2),
		);

		const result = await runCommandTool.execute(
			{ command: 'npm --version', _intent: 'verify npm works in workspace' },
			{},
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('Command completed successfully');
		expect(result.content).toMatch(/\d+\.\d+\.\d+/);

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});

	it('应能执行 find | wc -l pipeline', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-pipeline-'));
		process.env.AGENT_WORKSPACE = workspace;

		await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
		await fs.writeFile(path.join(workspace, 'src', 'a.ts'), 'export const a = 1;\n');
		await fs.writeFile(path.join(workspace, 'src', 'b.ts'), 'export const b = 2;\n');

		const result = await runCommandTool.execute(
			{ command: 'find src -name *.ts | wc -l', _intent: 'count ts files' },
			{},
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('2');

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});

	it('应能执行安全 shell 脚本片段', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-shell-'));
		process.env.AGENT_WORKSPACE = workspace;

		const result = await runCommandTool.execute(
			{ command: 'echo first && echo second', _intent: 'verify shell execution' },
			{},
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('first');
		expect(result.content).toContain('second');

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});

	it('应拒绝包含危险删除的 package script', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-danger-script-'));
		process.env.AGENT_WORKSPACE = workspace;

		await fs.writeFile(
			path.join(workspace, 'package.json'),
			JSON.stringify({ scripts: { clean: 'rm -rf dist' } }, null, 2),
		);

		const result = await runCommandTool.execute(
			{ command: 'npm run clean', _intent: 'verify dangerous script is blocked' },
			{},
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain('Package script "clean" is blocked');

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});

	it('应把长运行 dev 脚本作为后台命令启动', async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-cli-dev-script-'));
		process.env.AGENT_WORKSPACE = workspace;

		await fs.writeFile(
			path.join(workspace, 'package.json'),
			JSON.stringify(
				{
					scripts: {
						dev: 'node -e "console.log(\\"ready\\"); setInterval(() => {}, 1000)"',
					},
				},
				null,
				2,
			),
		);

		const result = await runCommandTool.execute(
			{ command: 'npm run dev', _intent: 'verify long running dev script starts' },
			{},
		);

		expect(result.isError).toBe(false);
		expect(result.content).toContain('Background command started.');
		expect(result.content).toContain('Pid: ');
		expect(result.content).toContain('Log: ');

		const pid = Number(result.content.match(/Pid: (\d+)/)?.[1]);
		if (Number.isFinite(pid)) {
			try {
				process.kill(-pid, 'SIGTERM');
			} catch {}
		}

		await fs.rm(workspace, { recursive: true, force: true });
		delete process.env.AGENT_WORKSPACE;
	});
});
