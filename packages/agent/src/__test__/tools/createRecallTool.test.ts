import { EventType } from '@light-agent/protocol/events';
import { describe, expect, it } from 'vitest';
import createRecallTool from '../../tools/createRecallTool.ts';

import type { AgentEvent } from '@light-agent/protocol/events';

describe('recall_indexed', () => {
	it('应只召回 canonical 中的 tool result', async () => {
		const roundId = 'round_id_test';
		const events: AgentEvent[] = [
			{
				type: EventType.Tool_Calls,
				tool_calls: [
					{
						id: 'call_1',
						name: 'write_file',
						args: { path: 'src/a.ts', content: 'hello world' },
					},
				],
				meta: { roundId, turn: 1 },
			},
			{
				type: EventType.Tool_Result,
				tool_result: {
					id: 'call_1',
					name: 'write_file',
					result: 'File written successfully.',
					isError: false,
				},
				meta: { roundId, turn: 1 },
			},
		];

		const tool = createRecallTool(() => events);
		const result = await tool.execute({ id: 'call_1' }, { cwd: '/tmp/workspace', signal: undefined });

		expect(result.isError).toBe(false);
		expect(result.content).toBe('File written successfully.');
		expect(result.content).not.toContain('tool_args:');
	});
});
