import { stdin } from 'node:process';
import type { Interface } from 'node:readline/promises';

const PASTE_COALESCE_MS = 40;

export type ReadCliInputOptions = {
	prompt?: string;
	continuationPrompt?: string;
	onCancel?: () => void;
};

export function isSubmittableCliInput(text: string) {
	const trimmed = text.trim();
	return trimmed.length > 0 && trimmed !== '>';
}

/** Drop keystrokes/paste that arrived while the agent was running. */
export function drainStdinBuffer() {
	if (!stdin.isTTY) {
		return;
	}

	stdin.setEncoding('utf8');
	while (stdin.read() !== null) {
		// discard buffered stdin
	}
}

/**
 * Read one user turn from the CLI.
 * - Single line: Enter submits (paste with newlines coalesces within a short window).
 * - Multiline: type """ on its own line, then paste/edit; close with """ on its own line.
 */
export function readCliInput(
	rl: Interface,
	options: ReadCliInputOptions = {},
): Promise<string> {
	const prompt = options.prompt ?? '> ';
	const continuationPrompt = options.continuationPrompt ?? '.. ';

	return new Promise((resolve, reject) => {
		const lines: string[] = [];
		let multilineMode = false;
		let settled = false;
		let pasteTimer: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (pasteTimer) {
				clearTimeout(pasteTimer);
				pasteTimer = undefined;
			}
			rl.off('line', onLine);
			rl.off('close', onClose);
			rl.pause();
		};

		const finish = (text: string) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(text);
		};

		const onClose = () => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			options.onCancel?.();
			reject(Object.assign(new Error('readline was closed'), { code: 'ERR_USE_AFTER_CLOSE' }));
		};

		const showPrompt = () => {
			rl.setPrompt(multilineMode ? continuationPrompt : prompt);
			rl.prompt();
		};

		const tryFinish = () => {
			const text = lines.join('\n').trim();
			if (!isSubmittableCliInput(text)) {
				lines.length = 0;
				showPrompt();
				return;
			}
			finish(text);
		};

		const scheduleFinish = () => {
			if (pasteTimer) {
				clearTimeout(pasteTimer);
			}
			pasteTimer = setTimeout(tryFinish, PASTE_COALESCE_MS);
		};

		const onLine = (line: string) => {
			const normalized = line.replace(/\r$/, '');

			if (multilineMode) {
				if (normalized.trim() === '"""') {
					tryFinish();
					return;
				}

				lines.push(normalized);
				showPrompt();
				return;
			}

			if (normalized.trim() === '"""') {
				multilineMode = true;
				lines.length = 0;
				process.stdout.write('(multiline — close with """)\n');
				showPrompt();
				return;
			}

			if (!normalized.trim() && lines.length === 0) {
				showPrompt();
				return;
			}

			lines.push(normalized);
			scheduleFinish();
		};

		rl.resume();
		rl.on('line', onLine);
		rl.on('close', onClose);
		showPrompt();
	});
}
