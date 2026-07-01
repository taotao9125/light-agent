import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/*/src/**/__test__/**/*.test.ts'],
		environment: 'node',
	},
});
