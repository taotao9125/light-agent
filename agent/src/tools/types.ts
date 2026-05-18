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
	execute(p: T): U;
}