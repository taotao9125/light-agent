import { describe, expect, it } from 'vitest';

import { formatLlmError } from '../formatLlmError';

describe('formatLlmError', () => {
	it('传输错误 terminated', () => {
		expect(formatLlmError(new TypeError('terminated'))).toBe('kind=transport | type=TypeError | msg=terminated');
	});

	it('HTTP API 401', () => {
		const error = Object.assign(new Error('Invalid API key'), {
			status: 401,
			error: { message: 'Incorrect API key provided', code: 'invalid_api_key' },
		});

		expect(formatLlmError(error)).toBe(
			'kind=http | msg=Incorrect API key provided | http=401 | apiCode=invalid_api_key',
		);
	});

	it('其它错误', () => {
		expect(formatLlmError(new Error('context length exceeded'))).toBe(
			'kind=other | msg=context length exceeded',
		);
	});
});
