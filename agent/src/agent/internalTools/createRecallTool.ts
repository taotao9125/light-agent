import { type Tool } from '../tool';
import { type Context } from '../context/contextBuilder';

function createRecallIndexTool(getSSOTEventsIndexes: () => Context.BuildResult['ssotEventIndexes']): Tool.Definition {
	return {
		name: 'recall_indexed',
		description:
			'Recall the full content for a previously indexed observation. Use when tool result shows [indexed:...:<id>] and you need the original full text to continue.',
		schema: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: 'The index id from the placeholder, e.g. call_id from [indexed:tool_result:call_id].',
				},
			},
			required: ['id'],
			additionalProperties: false,
		},
		async execute(p: { id: string }, context) {
			context.signal?.throwIfAborted();
			const id = p.id?.trim();
			const indexes = getSSOTEventsIndexes();
			if (!id) return { isError: true, content: '[index recall] missing id' };
			const entry = indexes.get(id);
			if (!entry) return { isError: true, content: `[index recall] not found: ${id}` };
			console.log(`<-----[召回] ${id}`);
			return {
				isError: false,
				content: entry.content,
			};
		},
	};
}

export default createRecallIndexTool;
