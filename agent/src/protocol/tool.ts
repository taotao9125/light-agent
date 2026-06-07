/** Tool schema exposed to the model (API tools field). */
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
}
