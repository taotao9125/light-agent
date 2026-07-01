import path from 'node:path';
import { parseArgs } from 'node:util';

export type CliArgs = {
	sessionFile: string;
	traceFile: string;
	contextFile: string;
	contextStrategy: boolean;
	maxTurns: number;
	help: boolean;
};

const DEFAULT_MAX_TURNS = 200;

function parseMaxTurns(raw: unknown) {
	const value = Number(raw ?? DEFAULT_MAX_TURNS);
	if (!Number.isFinite(value) || value < 1) {
		return DEFAULT_MAX_TURNS;
	}
	return Math.floor(value);
}

const DEFAULT_SESSION = '.agent/sessions/cli_session.jsonl';

function defaultSidecarFile(sessionFile: string, suffix: string) {
	if (sessionFile.endsWith('.jsonl')) {
		return sessionFile.replace(/\.jsonl$/, `.${suffix}.jsonl`);
	}
	return `${sessionFile}.${suffix}.jsonl`;
}

function resolvePath(cwd: string, filePath: string) {
	return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function stringValue(value: string | boolean | undefined, fallback: string) {
	return typeof value === 'string' ? value : fallback;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2), cwd = process.cwd()): CliArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			'session-file': { type: 'string' },
			'trace-file': { type: 'string' },
			'context-file': { type: 'string' },
			'context-strategy': { type: 'string', default: 'on' },
			'max-turns': { type: 'string', default: String(DEFAULT_MAX_TURNS) },
			help: { type: 'boolean', short: 'h', default: false },
		},
		allowPositionals: false,
		strict: false,
	});

	const sessionFile = resolvePath(cwd, stringValue(values['session-file'], DEFAULT_SESSION));
	const traceFile = resolvePath(cwd, stringValue(values['trace-file'], defaultSidecarFile(sessionFile, 'trace')));
	const contextFile = resolvePath(
		cwd,
		stringValue(values['context-file'], defaultSidecarFile(sessionFile, 'context')),
	);
	const strategyRaw = String(values['context-strategy'] ?? 'on').toLowerCase();
	const contextStrategy = strategyRaw === 'on' || strategyRaw === 'true' || strategyRaw === '1';

	return {
		sessionFile,
		traceFile,
		contextFile,
		contextStrategy,
		maxTurns: parseMaxTurns(values['max-turns']),
		help: values.help === true,
	};
}

export function printCliHelp() {
	return [
		'Usage: pnpm dev [options]',
		'',
		'Options:',
		'  --session-file <path>     Session jsonl path (default: .agent/sessions/cli_session.jsonl)',
		'  --trace-file <path>       Trace jsonl path (default: <session>.trace.jsonl)',
		'  --context-file <path>     Context snap jsonl path (default: <session>.context.jsonl)',
		'  --context-strategy on|off Enable hot/cold index + summary (default: on)',
		'  --max-turns <n>           Agent loop turn limit (default: 200)',
		'  -h, --help                Show this help',
		'',
		'Examples:',
		'  pnpm dev --session-file .agent/sessions/eval-a.jsonl --context-strategy on',
		'  pnpm dev --session-file .agent/sessions/eval-b.jsonl --context-strategy off',
	].join('\n');
}
