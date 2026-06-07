/** Tool schema、注册与执行。 */
export namespace Tool {
	export type Meta = {
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
			additionalProperties?: boolean;
		};
	};

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

	export interface Definition extends Meta {
		execute(p: Record<string, unknown>, context: ExecuteContext): Promise<Result>;
	}
}

export interface ToolRegistryInterface {
	register: (name: string, tool: Tool.Definition) => void;
	get: (name: string) => Tool.Definition | undefined;
	getTools: () => Tool.Definition[];
}

export default class ToolRegistry implements ToolRegistryInterface {
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
