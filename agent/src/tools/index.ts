import { listFilesTool, readFileTool } from './builtins';

import type { ToolMeta, ToolDefinition } from './types';

class ToolRegistry {
	private tools = new Map<string, ToolDefinition<any, any>>();

	register(tool: ToolDefinition<any, any>): void {
		this.tools.set(tool.name, tool);
	}

	get(name: string): ToolDefinition<any, any> | undefined {
		return this.tools.get(name);
	}

	getToolShapes(): ToolMeta[] {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: tool.schema,
		}));
	}
}

const toolRegistry = new ToolRegistry();

toolRegistry.register(readFileTool);
toolRegistry.register(listFilesTool);

export default toolRegistry;
