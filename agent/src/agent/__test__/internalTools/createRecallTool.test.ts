import { describe, expect, it } from 'vitest';

import { EventType } from '../../../protocol/events';
import createRecallTool from '../../internalTools/createRecallTool';

import type { AgentEvent } from '../../../protocol/events';

describe('recall_indexed', () => {
	it('应召回 canonical 中的 tool args 与 tool result', async () => {
		const roundId = 'round_id_test';
		const events: AgentEvent[] = [
			{
				type: EventType.ACTIONS,
				actions: [
					{
						id: 'call_1',
						name: 'write_file',
						args: { path: 'src/a.ts', content: 'hello world' },
					},
				],
				meta: { roundId, turn: 1 },
			},
			{
				type: EventType.OBSERVATIONS,
				observations: [
					{
						id: 'call_1',
						name: 'write_file',
						result: 'File written successfully.',
						isError: false,
					},
				],
				meta: { roundId, turn: 1 },
			},
		];

		const tool = createRecallTool(() => events);
		const result = await tool.execute({ id: 'call_1_round_id_test_1' }, { signal: undefined });

		expect(result.isError).toBe(false);
		expect(result.content).toContain('tool_args:');
		expect(result.content).toContain('"content": "hello world"');
		expect(result.content).toContain('tool_result:');
	});
});
