export type AIErrorKind = 'transport_error' | 'provider_error' | 'request_error' | 'abort_error' | 'unknown_error';

export class AIError extends Error {
	readonly kind: AIErrorKind;
	readonly retryable: boolean;
	readonly status?: number;
	readonly code?: string;
	override readonly cause?: unknown;

	constructor(config: {
		kind: AIErrorKind;
		message: string;
		retryable: boolean;
		status?: number;
		code?: string;
		cause?: unknown;
	}) {
		super(config.message);
		this.name = 'AIError';
		this.kind = config.kind;
		this.retryable = config.retryable;
		this.status = config.status;
		this.code = config.code;
		this.cause = config.cause;
	}
}

export function shouldRetryAIError(error: unknown): boolean {
	return error instanceof AIError && error.retryable;
}
