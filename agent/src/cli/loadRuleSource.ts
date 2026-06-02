import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import path from 'path';

export default async function loadRuleSources(
	cwd: string,
): Promise<{ name?: string; path?: string; content: string }[]> {
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
				name: path.basename(entry),
				path: entry,
				content: content.trim(),
			};
		}),
	);

	return rules;
}
