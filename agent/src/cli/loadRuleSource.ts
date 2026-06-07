import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import path from 'path';

import type { Context } from '../agent/contextBuilder';

export default async function loadRuleSources(cwd: string): Promise<Context.Rule[]> {
	const entries = await fg(
		// todo: remove path
		['src/cli/.agent/rules/**/*.md'],
		{
			cwd,
			onlyFiles: true,
			absolute: false,
		},
	);
	const rules = Promise.all(
		entries.map(async (entry) => {
			const filePath = path.resolve(cwd, entry);
			const content = await readFile(filePath, 'utf-8');
			return {
				layer: 'project' as const,
				name: path.basename(entry),
				path: entry,
				content: content.trim(),
			};
		}),
	);

	return rules;
}
