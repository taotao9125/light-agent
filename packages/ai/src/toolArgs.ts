const STRING_FIELD_PATTERN = /"(path|query)"\s*:\s*"((?:\\.|[^"\\])*)/g;

function decodeJsonStringFragment(value: string) {
	try {
		return JSON.parse(`"${value.replace(/\\$/, '')}"`) as string;
	} catch {
		return value;
	}
}

export function tryParsePathFromPartialToolArgs(args: string) {
	return previewPartialToolArgs(args).path;
}

export function previewPartialToolArgs(args: string) {
	const preview: { path?: string; query?: string } = {};

	for (const match of args.matchAll(STRING_FIELD_PATTERN)) {
		const key = match[1] as 'path' | 'query';
		preview[key] = decodeJsonStringFragment(match[2]);
	}

	return preview;
}
