import { describe, expect, it } from 'vitest';
import { previewPartialToolArgs, tryParsePathFromPartialToolArgs } from '../toolArgs.ts';

describe('tryParsePathFromPartialToolArgs', () => {
	it('应从完整 JSON 解析 path', () => {
		expect(tryParsePathFromPartialToolArgs('{"path":"todo-demo/src/App.tsx","content":"export {}"}')).toBe(
			'todo-demo/src/App.tsx',
		);
	});

	it('应从流式未闭合 JSON 解析 path', () => {
		expect(
			tryParsePathFromPartialToolArgs('{"path":"todo-demo/src/components/TodoInput.tsx","content":"import'),
		).toBe('todo-demo/src/components/TodoInput.tsx');
	});
});

describe('previewPartialToolArgs', () => {
	it('应同时提取 path 与 query', () => {
		expect(previewPartialToolArgs('{"path":"a.ts","query":"auth flow","_intent":"x"}')).toEqual({
			path: 'a.ts',
			query: 'auth flow',
		});
	});
});
