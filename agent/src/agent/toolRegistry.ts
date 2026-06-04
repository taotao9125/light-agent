import type { ToolDefinition } from './types';

class ToolRegistry {
	private tools = new Map<string, ToolDefinition>();

	register(name: string, tool: ToolDefinition): void {
		this.tools.set(name, tool);
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	getTools() {
		return [...this.tools.values()];
	}
}

export default ToolRegistry;
