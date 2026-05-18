import { readFileTool } from './buildins';

import type {ToolDefinition} from './types';

class ToolRegistry {
	private tools = new Map<string, ToolDefinition<any, any>>();

	register(name: string, tool: ToolDefinition<any, any>): void {
		this.tools.set(name, tool);
	}

	get(name: string): ToolDefinition<any, any> | undefined {
		return this.tools.get(name);
	}

	list(): Omit<ToolDefinition<any, any>, 'execute'>[] {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: tool.schema,
		}));
	}
}

const toolRegistry = new ToolRegistry();

toolRegistry.register(readFileTool.name, readFileTool);

export default toolRegistry;
