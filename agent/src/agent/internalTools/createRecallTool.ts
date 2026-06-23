import { type Tool } from '../tool';
import { type SSOTEvent, type ObservationsEvent } from '../../protocol/events';
import { EventType } from '../../protocol/events';

function createRecallIndexTool(getSSOTEvents: () => SSOTEvent[]): Tool.Definition {
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
			// id = call_00_xxx_round_id_mqq56r0ry8sb04h_4
			const splitedParts = id.split('_round_id_');
			const callId = splitedParts[0];
			const [roundIdStr, turnIndex] = splitedParts[1].split('_');
			const roundId = `round_id_${roundIdStr}`;
			const turn = +turnIndex;
			
			const events = getSSOTEvents();

			const obsEvent = events.find(event =>  
				event.type === EventType.OBSERVATIONS 
				&&  event.meta?.roundId === roundId 
				&& event.meta?.turn === turn
			) as ObservationsEvent;

			const obs = obsEvent.observations.find(obs => obs.id === callId);

			if (obs) {
				console.log(`<-----[召回] 成功${id}`);
				return {
					isError: false,
					content: obs.result
				}
			}

			return {
				isError: true,
				content: ''
			}
		}
	};
}

export default createRecallIndexTool;
