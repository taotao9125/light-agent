import ragSearch from '../../rag/index';

import type { Tool } from '../../agent/tool';

type SearchDocResult = {
	rank: number;
	score: number;
	text: string;
	source?: string;
	metadata?: Record<string, unknown>;
};

export function formatSearchResults(query: string, topK: number, results: SearchDocResult[]) {
	if (!results.length) {
		return ['No matching private documents found.', `Query: ${query}`, `Top K: ${topK}`].join('\n');
	}

	return [
		'Search results for private documents',
		`Query: ${query}`,
		`Top K: ${topK}`,
		'',
		...results.map((item) =>
			[
				`[${item.rank}]`,
				`source: ${item.source ?? 'unknown'}`,
				`score: ${Number(item.score).toFixed(4)}`,
				'content:',
				item.text.trim(),
			].join('\n'),
		),
	].join('\n\n');
}

const searchDoc: Tool.Definition = {
	name: 'search_docs',
	description:
		'Search private project documents when the answer requires project-specific knowledge not already present in the conversation.',
	schema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					"A focused retrieval query. Rewrite the user's question into keywords, file names, concepts, APIs, or implementation terms that are likely to appear in the private documents. Do not simply copy the full user message if a shorter search query would be more precise.",
			},
			topK: {
				type: 'number',
				description:
					'The maximum number of document chunks to return. Use 3 for normal questions, 5 when the question needs broader context, and 8 only for complex cross-file questions.',
			},
		},
		required: ['query'],
	},

	async execute(p: { query: string; topK?: number }, context) {
		context.signal?.throwIfAborted();
		try {
			const topK = p.topK ?? 3;
			const results = await ragSearch(p.query, topK);
			return {
				isError: false,
				content: formatSearchResults(p.query, topK, results),
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: ['Failed to search private documents.', `Query: ${p.query}`, `Reason: ${e instanceof Error ? e.message : String(e)}`].join('\n'),
			};
		}
	},
};

export default searchDoc;
