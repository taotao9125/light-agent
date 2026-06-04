export function textResult(text: string, isError = false) {
	return {
		isError,
		content: [
			{
				type: 'text' as const,
				text,
			},
		],
	};
}

export function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

