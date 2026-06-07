import type { Content, FunctionCall, FunctionDeclaration, GenerateContentParameters } from '@google/genai';
import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { type AgentEvent, EventType } from '../../protocol/events';
import { parseTurnEventGroup, splitEventsToRoundGroups } from '../../protocol/eventGroups';
import { stringifyContent } from '../helpers';
import type { Vender } from '../index';

const normalizeGoogleContents = (events: AgentEvent[]): Content[] => {
	const roundGroups = splitEventsToRoundGroups(events);

	return roundGroups.flatMap((roundGroup): Content[] => {
		const { input, turns } = roundGroup;
		const contents: Content[] = [];

		if (input?.type === EventType.INPUT) {
			contents.push({
				role: 'user',
				parts: [{ text: input.text }],
			});
		}

		for (const turnEvents of turns) {
			const { thought, actions, observations, output } = parseTurnEventGroup(turnEvents);

			const thoughtText = thought?.type === EventType.THOUGHT && thought.text ? thought.text : null;
			const outputText = output?.type === EventType.OUTPUT && output.text ? output.text : null;

			if (actions.length) {
				contents.push({
					role: 'model',
					parts: [
						...(thoughtText ? [{ text: thoughtText, thought: true }] : []),
						...(outputText ? [{ text: outputText }] : []),
						...actions.map((action) => ({
							functionCall: {
								id: action.id,
								name: action.name,
								args: action.args,
							},
						})),
					],
				});

				if (observations.length) {
					contents.push({
						role: 'user',
						parts: observations.map((observation) => ({
							functionResponse: {
								id: observation.id,
								name: observation.name,
								response: {
									output: stringifyContent(observation.result),
								},
							},
						})),
					});
				}

				continue;
			}

			if (thoughtText || outputText) {
				contents.push({
					role: 'model',
					parts: [
						...(thoughtText ? [{ text: thoughtText, thought: true }] : []),
						...(outputText ? [{ text: outputText }] : []),
					],
				});
			}
		}

		return contents;
	});
};

export default class GoogleAdaptor implements Vender.Adaptor {
	private client: GoogleGenAI;
	private vender: Vender.Config;

	constructor(vender: Vender.Config) {
		this.vender = vender;
		this.client = new GoogleGenAI({ apiKey: vender.apiKey });
	}

	protected normalizeRequestConfig(input: Vender.StreamInput): GenerateContentParameters {
		const functionDeclarations: FunctionDeclaration[] =
			input.tools?.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parametersJsonSchema: tool.schema,
			})) ?? [];

		return {
			model: this.vender.model,
			contents: normalizeGoogleContents(input.input),
			config: {
				systemInstruction: input.systemPrompt,
				thinkingConfig: {
					includeThoughts: true,
				},
				tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
				toolConfig: functionDeclarations.length
					? {
							functionCallingConfig: {
								mode: FunctionCallingConfigMode.AUTO,
							},
						}
					: undefined,
			},
		};
	}

	async *stream(input: Vender.StreamInput): ReturnType<Vender.Adaptor['stream']> {
		const config = this.normalizeRequestConfig(input);
		const functionCalls: FunctionCall[] = [];
		let thoughtTextBuffer = '';
		let outputTextBuffer = '';

		try {
			const stream = await this.client.models.generateContentStream(config);

			for await (const chunk of stream) {
				const parts = chunk.candidates?.[0]?.content?.parts ?? [];

				for (const part of parts) {
					if (part.text) {
						if (part.thought) {
							thoughtTextBuffer += part.text;
							yield { type: EventType.THOUGHT_DELTA, text: part.text };
						} else {
							outputTextBuffer += part.text;
							yield { type: EventType.OUTPUT_DELTA, text: part.text };
						}
					}

					if (part.functionCall) {
						functionCalls.push(part.functionCall);
					}
				}

				if (!parts.length && chunk.functionCalls?.length) {
					functionCalls.push(...chunk.functionCalls);
				}
			}

			// thought -> action -> output
			if (!functionCalls.length && !outputTextBuffer) {
				yield {
					type: EventType.AGENT_STOP,
					cause: 'llm',
					message: 'LLM did not return an action or output.',
				};
			}

			if (thoughtTextBuffer) {
				yield { type: EventType.THOUGHT, text: thoughtTextBuffer };
			}

			for (const [index, call] of functionCalls.entries()) {
				if (!call.name) continue;

				yield {
					type: EventType.ACTION,
					id: call.id ?? `google_call_${index}_${call.name}`,
					name: call.name,
					args: call.args ?? {},
				};
			}

			if (outputTextBuffer) {
				yield { type: EventType.OUTPUT, text: outputTextBuffer };
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: EventType.AGENT_STOP, cause: 'llm', message };
		}
	}
}
