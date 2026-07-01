import { describe, expect, it } from 'vitest';
import { parseCliArgs, printCliHelp } from '../parseCliArgs.ts';

describe('parseCliArgs', () => {
	it('默认 session/trace 路径', () => {
		const args = parseCliArgs([], '/repo/agent');

		expect(args.sessionFile).toBe('/repo/agent/.agent/sessions/cli_session.jsonl');
		expect(args.traceFile).toBe('/repo/agent/.agent/sessions/cli_session.trace.jsonl');
		expect(args.contextFile).toBe('/repo/agent/.agent/sessions/cli_session.context.jsonl');
		expect(args.contextStrategy).toBe(true);
		expect(args.maxTurns).toBe(200);
	});

	it('支持自定义 session/trace 与关闭策略', () => {
		const args = parseCliArgs(
			[
				'--session-file',
				'runs/eval-a.jsonl',
				'--trace-file',
				'runs/eval-a.trace.jsonl',
				'--context-strategy',
				'off',
			],
			'/repo/agent',
		);

		expect(args.sessionFile).toBe('/repo/agent/runs/eval-a.jsonl');
		expect(args.traceFile).toBe('/repo/agent/runs/eval-a.trace.jsonl');
		expect(args.contextStrategy).toBe(false);
	});

	it('supports custom max-turns', () => {
		const args = parseCliArgs(['--max-turns', '300'], '/repo/agent');
		expect(args.maxTurns).toBe(300);
	});

	it('help', () => {
		expect(printCliHelp()).toContain('--session-file');
	});
});
