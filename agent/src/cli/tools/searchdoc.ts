import type { ToolDefinition } from '../../agent/types';
import ragSearch from '../../rag/index';

const searchDoc: ToolDefinition = {
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
			const results = await ragSearch(p.query, p.topK);
			return {
				isError: false,
				content: [
					{
						type: 'text',
						text: JSON.stringify(results),
					},
				],
			};
		} catch (e) {
			context.signal?.throwIfAborted();
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: e instanceof Error ? e.message : String(e),
					},
				],
			};
		}
	},
};

export default searchDoc;
