import { readFileTool } from './buildins';

export type ToolMeta = {
	name: string;
	description: string;
	schema: {
		type: 'object';
		properties: Record<
			string,
			{
				type: unknown;
				description: string;
			}
		>;
		required?: string[];
	};
};

export interface ToolDefinition<T, U> extends ToolMeta {
	excute(p: T): U;
}

class ToolFactoryCls {
	private tools = new Map<string, ToolDefinition<any, any>>();

	register(name: string, tool: ToolDefinition<any, any>): void {
		this.tools.set(name, tool);
	}

	get(name: string): ToolDefinition<any, any> | undefined {
		return this.tools.get(name);
	}

	list(): Omit<ToolDefinition<any, any>, 'excute'>[] {
		return Array.from(this.tools.values()).map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: tool.schema,
		}));
	}
}

const ToolFactory = new ToolFactoryCls();

ToolFactory.register(readFileTool.name, readFileTool);

export default ToolFactory;
