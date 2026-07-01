import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
	name: 'agent-demo-mcp',
	version: '1.0.0',
});

server.tool(
	'add_numbers',
	'Add two numbers and return the sum. Use this to verify the MCP server can receive tool calls and return results.',
	{
		a: z.number().describe('First number.'),
		b: z.number().describe('Second number.'),
	},
	async ({ a, b }) => ({
		content: [
			{
				type: 'text',
				text: `sum=${a + b}`,
			},
		],
	}),
);

server.tool(
	'get_agent_runtime_summary',
	'Summarize the local demo agent runtime concepts exposed by this MCP server.',
	{},
	async () => ({
		content: [
			{
				type: 'text',
				text: [
					'Agent runtime summary:',
					'- The inner loop runs model -> tool -> observation until output, stop, abort, or max turns.',
					'- Tools are structured action interfaces exposed to the model.',
					'- Observations are tool results returned to the model as future context.',
					'- Long tasks need an outer task controller with structured task state.',
				].join('\n'),
			},
		],
	}),
);

const transport = new StdioServerTransport();

await server.connect(transport);
