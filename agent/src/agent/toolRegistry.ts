import type { Tool as ProtocolTool } from '../protocol/tool';

/** Tool registry and execution. */
export namespace Tool {
	export type Meta = ProtocolTool.Meta;

	export type ExecuteContext = {
		signal?: AbortSignal;
	};

	export type Result = {
		isError: boolean;
		content: {
			type: 'text';
			text: string;
		}[];
	};

	export interface Definition extends ProtocolTool.Meta {
		execute(p: Record<string, unknown>, context: ExecuteContext): Promise<Result>;
	}
}

class ToolRegistry {
	private tools = new Map<string, Tool.Definition>();

	register(name: string, tool: Tool.Definition): void {
		this.tools.set(name, tool);
	}

	get(name: string): Tool.Definition | undefined {
		return this.tools.get(name);
	}

	getTools() {
		return [...this.tools.values()];
	}
}

export default ToolRegistry;
