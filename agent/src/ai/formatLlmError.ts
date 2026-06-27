export function formatLlmError(error: unknown): string {
	if (!(error instanceof Error)) {
		return `kind=other | msg=${String(error)}`;
	}

	const e = error as Error & {
		status?: number;
		code?: unknown;
		error?: { message?: string; code?: string };
	};

	const http = typeof e.status === 'number' ? e.status : undefined;

	// 1. HTTP API 错误
	if (http !== undefined) {
		const msg = e.error?.message ?? e.message;
		const apiCode = typeof e.error?.code === 'string' ? e.error.code : undefined;

		return [
			'kind=http',
			`msg=${msg}`,
			`http=${http}`,
			apiCode && `apiCode=${apiCode}`,
		]
			.filter(Boolean)
			.join(' | ');
	}

	const msg = e.message;
	const code = e.code != null ? String(e.code) : undefined;
	const type = e.name !== 'Error' ? e.name : undefined;

	// 2. 传输 / 流式错误
	const isTransport =
		msg === 'terminated' ||
		code === 'ECONNRESET' ||
		code === 'UND_ERR_SOCKET' ||
		code === 'ETIMEDOUT' ||
		msg.includes('timeout');

	if (isTransport) {
		return ['kind=transport', type && `type=${type}`, `msg=${msg}`, code && `code=${code}`]
			.filter(Boolean)
			.join(' | ');
	}

	// 3. 其它
	return `kind=other | msg=${e.error?.message ?? e.message}`;
}
