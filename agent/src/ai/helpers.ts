export const stringifyContent = (content: unknown): string => {
	if (typeof content === 'string') return content;
	return JSON.stringify(content);
};
