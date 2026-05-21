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
		additionalProperties?: boolean;
	};
};

export type ToolContext = {
	cwd: string;
};

export interface ToolDefinition<T, U> extends ToolMeta {
	execute(p: T, context: ToolContext): U;
}
