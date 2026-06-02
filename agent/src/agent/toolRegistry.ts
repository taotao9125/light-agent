import type { ToolDefinition } from './types';

class ToolRegistry {
	private tools = new Map<string, ToolDefinition<any, any>>();

	register(name: string, tool: ToolDefinition<any, any>): void {
		this.tools.set(name, tool);
	}

	get(name: string): ToolDefinition<any, any> | undefined {
		return this.tools.get(name);
	}

	getTools() {
		return [...this.tools.values()];
	}
}

export default ToolRegistry;
