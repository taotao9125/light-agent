import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { isSubmittableCliInput, readCliInput } from '../readCliInput';

type FakeReadline = EventEmitter & {
	write: (text: string) => void;
	setPrompt: (prompt: string) => void;
	prompt: () => void;
	pause: () => void;
	resume: () => void;
};

function createFakeReadline() {
	const rl = new EventEmitter() as FakeReadline;
	rl.write = () => {};
	rl.setPrompt = () => {};
	rl.prompt = () => {};
	rl.pause = () => {};
	rl.resume = () => {};
	return rl;
}

describe('isSubmittableCliInput', () => {
	it('应拒绝空输入和单独的 >', () => {
		expect(isSubmittableCliInput('')).toBe(false);
		expect(isSubmittableCliInput('   ')).toBe(false);
		expect(isSubmittableCliInput('>')).toBe(false);
	});

	it('应接受正常文本', () => {
		expect(isSubmittableCliInput('hello')).toBe(true);
	});
});

describe('readCliInput', () => {
	it('单行输入应在短 debounce 后返回', async () => {
		const rl = createFakeReadline();
		const pending = readCliInput(rl as never, { prompt: '> ' });

		rl.emit('line', 'hello');

		await expect(pending).resolves.toBe('hello');
	});

	it('粘贴多行应合并为一条 prompt', async () => {
		const rl = createFakeReadline();
		const pending = readCliInput(rl as never);

		rl.emit('line', 'line 1');
		rl.emit('line', 'line 2');
		rl.emit('line', 'line 3');

		await expect(pending).resolves.toBe('line 1\nline 2\nline 3');
	});

	it('""" 模式应读取直到 closing delimiter', async () => {
		const rl = createFakeReadline();
		const pending = readCliInput(rl as never);

		rl.emit('line', '"""');
		rl.emit('line', 'first');
		rl.emit('line', 'second');
		rl.emit('line', '"""');

		await expect(pending).resolves.toBe('first\nsecond');
	});

	it('空行不应触发 agent 提交', async () => {
		const rl = createFakeReadline();
		const pending = readCliInput(rl as never);
		let settled = false;
		void pending.then(() => {
			settled = true;
		});

		rl.emit('line', '');
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(settled).toBe(false);

		rl.emit('line', 'real task');
		await expect(pending).resolves.toBe('real task');
	});
});
