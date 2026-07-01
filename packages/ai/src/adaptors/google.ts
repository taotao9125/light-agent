import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { EventType } from '@light-agent/protocol/events';
import { formatLlmError } from '../formatLlmError.ts';
import { parseEventsIntoRoundMap, stringifyContent } from '../helpers.ts';

import type { Content, FunctionCall, FunctionDeclaration, GenerateContentParameters } from '@google/genai';
import type { AgentEvent } from '@light-agent/protocol/events';
import type { Vender } from '../index.ts';

const normalizeGoogleContents = (events: AgentEvent[]): Content[] => {
	const roundsMap = parseEventsIntoRoundMap(events);
	const roundsList = [...roundsMap.values()];
	const roundsContents = roundsList.map((round) => {
		const roundContents: Content[] = [];
		const turnsList = [...round.values()];
		for (const oneTurnEvents of turnsList) {
			const inputEvent = oneTurnEvents.find((event) => event.type === EventType.INPUT);
			const thoughtEvent = oneTurnEvents.find((event) => event.type === EventType.THOUGHT);
			const actionsEvent = oneTurnEvents.find((event) => event.type === EventType.ACTIONS);
			const observationsEvent = oneTurnEvents.find((event) => event.type === EventType.OBSERVATIONS);
			const outputEvent = oneTurnEvents.find((event) => event.type === EventType.OUTPUT);

			if (inputEvent) {
				roundContents.push({
					role: 'user',
					parts: [{ text: inputEvent.text }],
				});
			}

			if (actionsEvent?.actions.length) {
				roundContents.push({
					role: 'model',
					parts: [
						...(thoughtEvent?.text ? [{ text: thoughtEvent.text, thought: true }] : []),
						...(outputEvent?.text ? [{ text: outputEvent.text }] : []),
						...actionsEvent.actions.map((action) => ({
							functionCall: {
								id: action.id,
								name: action.name,
								args: action.args,
							},
						})),
					],
				});

				if (observationsEvent?.observations.length) {
					roundContents.push({
						role: 'user',
						parts: observationsEvent.observations.map((observation) => ({
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
			} else if (outputEvent || thoughtEvent) {
				roundContents.push({
					role: 'model',
					parts: [
						...(thoughtEvent?.text ? [{ text: thoughtEvent.text, thought: true }] : []),
						...(outputEvent?.text ? [{ text: outputEvent.text }] : []),
					],
				});
			}
		}

		return roundContents;
	});

	return roundsContents.flat();
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

			const actions = functionCalls.flatMap((call, index) => {
				if (!call.name) return [];

				return [
					{
						id: call.id ?? `google_call_${index}_${call.name}`,
						name: call.name,
						args: call.args ?? {},
					},
				];
			});

			if (actions.length) {
				yield { type: EventType.ACTIONS, actions };
			}

			if (outputTextBuffer) {
				yield { type: EventType.OUTPUT, text: outputTextBuffer };
			}
		} catch (e) {
			yield { type: EventType.AGENT_STOP, cause: 'llm', message: formatLlmError(e) };
		}
	}

	async _generateText(_input: Vender.GenerateTextInput): Promise<Vender.GenerateTextResult> {
		throw new Error('Google adaptor does not support _generateText yet');
	}
}
