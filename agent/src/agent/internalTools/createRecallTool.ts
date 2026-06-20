import { type Tool } from '../tool';
import { type Context } from '../context/contextBuilder';



function textResult(text: string, isError = false) {
    return {
        isError,
        content: [
            {
                type: 'text' as const,
                text,
            },
        ],
    };
}


function createRecallIndexTool(getSSOTEventsIndexes: () => Context.BuildResult['ssotEventIndexes']): Tool.Definition {
    return {
        name: 'recall_indexed',
        description: 'Recall the full content for a previously indexed observation. Use when tool result shows [indexed:...:<id>] and you need the original full text to continue.',
        schema: {
            type: 'object',
            properties: {
                id: {
                    type: 'string',
                    description:
                        'The index id from the placeholder, e.g. call_id from [indexed:tool_result:call_id].',
                },
            },
            required: ['id'],
            additionalProperties: false,

        },
        async execute(p: { id: string }, context) {
            context.signal?.throwIfAborted();
            const id = p.id?.trim();
            const indexes = getSSOTEventsIndexes();
            if (!id) return textResult('[index recall] missing id', true);
            const entry = indexes.get(id);
            if (!entry) return textResult(`[index recall] not found: ${id}`, true);
            console.log(`<-----[召回] ${id}`)
            return textResult(['[index recall]', id, entry.content].join('\n'));
        }
    }
}

export default createRecallIndexTool;