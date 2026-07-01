import { describe, expect, it } from 'vitest';
import { formatSearchResults } from '../../tools/searchdoc.ts';

function approximateTokens(text: string) {
	return Math.ceil(text.length / 4);
}

function asObservationText(contentText: string) {
	return JSON.stringify([
		{
			type: 'text',
			text: contentText,
		},
	]);
}

function percentReduction(before: number, after: number) {
	return ((before - after) / before) * 100;
}

describe('工具观察结果格式化', () => {
	it('相比嵌套 JSON，search_docs 的观察结果更短', () => {
		const chunkText =
			'Agent loop 会运行模型、工具和观察结果循环。当没有工具动作或达到运行时限制时，它会停止。'.repeat(8);

		const results = [1, 2, 3].map((rank) => ({
			rank,
			score: 0.84 - rank / 100,
			text: chunkText,
			source: 'agent.pdf',
			metadata: {
				source: 'agent.pdf',
				loc: { pageNumber: rank },
				chunkId: `chunk_${rank}`,
				embeddingModel: 'bge-m3',
				createdAt: '2026-06-04T00:00:00.000Z',
			},
		}));

		const oldObservation = asObservationText(JSON.stringify(results));
		const newObservation = asObservationText(formatSearchResults('agent loop 停止条件', 3, results));
		const reduction = percentReduction(oldObservation.length, newObservation.length);

		console.info(
			`search_docs 观察结果：旧格式=${oldObservation.length} 字符，新格式=${newObservation.length} 字符，下降=${reduction.toFixed(2)}%，旧格式近似 token=${approximateTokens(oldObservation)}，新格式近似 token=${approximateTokens(newObservation)}`,
		);

		expect(newObservation.length).toBeLessThan(oldObservation.length);
		expect(approximateTokens(newObservation)).toBeLessThan(approximateTokens(oldObservation));
		expect(reduction).toBeGreaterThan(10);
	});

	it('相比 JSON entry 数组，list_files 的观察结果更短', () => {
		const entries = Array.from({ length: 24 }, (_, index) => ({
			name: `file-${index}.ts`,
			type: index % 4 === 0 ? 'directory' : 'file',
		}));

		const oldObservation = asObservationText(JSON.stringify(entries));
		const newObservation = asObservationText(
			[`Directory: agent/src`, '', ...entries.map((entry) => `- ${entry.name} [${entry.type}]`)].join('\n'),
		);
		const reduction = percentReduction(oldObservation.length, newObservation.length);

		console.info(
			`list_files 观察结果：旧格式=${oldObservation.length} 字符，新格式=${newObservation.length} 字符，下降=${reduction.toFixed(2)}%，旧格式近似 token=${approximateTokens(oldObservation)}，新格式近似 token=${approximateTokens(newObservation)}`,
		);

		expect(newObservation.length).toBeLessThan(oldObservation.length);
		expect(approximateTokens(newObservation)).toBeLessThan(approximateTokens(oldObservation));
		expect(reduction).toBeGreaterThan(20);
	});
});
