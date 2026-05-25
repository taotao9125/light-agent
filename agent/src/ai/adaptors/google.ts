import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import type { Content, FunctionCall, FunctionDeclaration, GenerateContentParameters } from '@google/genai';
import { type AgentEvent, EventType } from '../../protocol/events';
import { parseEventGroup, splitEventsToGroups } from '../helpers';
import type { AiProvider, AiRequestConfig, clientConfig } from '../index';

const normalizeGoogleContents = (events: AgentEvent[]): Content[] => {
	// Your eventLog is committed by LLM turn. Google expects a history of
	// Content objects, so each OutputEvent-ended group becomes one or more
	// user/model contents.
	const eventGroups = splitEventsToGroups(events);

	return eventGroups.flatMap((group): Content[] => {
		const { input, thought, actions, observations, output } = parseEventGroup(group);
		const contents: Content[] = [];

		if (input?.type === EventType.INPUT) {
			// Gemini uses role "user" for human/system input in the contents
			// history. System-level steering can later move to systemInstruction.
			contents.push({
				role: 'user',
				parts: [{ text: input.text }],
			});
		}

		const thoughtText = thought?.type === EventType.THOUGHT && thought.text ? thought.text : null;
		const outputText = output?.type === EventType.OUTPUT && output.text ? output.text : null;

		if (actions.length) {
			contents.push({
				role: 'model',
				parts: [
					// Thought parts are Gemini's reasoning representation.
					// `thought: true` keeps them separate from visible text.
					...(thoughtText ? [{ text: thoughtText, thought: true }] : []),
					// Output text is visible assistant content. It may be a
					// progress message before a tool call.
					...(outputText ? [{ text: outputText }] : []),
					// ActionEvent maps to Gemini functionCall parts.
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
					// Function responses are sent as user-role content because
					// they are external results returned back to the model.
					role: 'user',
					parts: observations.map((observation) => ({
						functionResponse: {
							id: observation.id,
							name: observation.name,
							response: {
								output: observation.result,
							},
						},
					})),
				});
			}

			return contents;
		}

		if (thoughtText || outputText) {
			contents.push({
				role: 'model',
				// No actions in this group means this is a model-only turn.
				parts: [...(thoughtText ? [{ text: thoughtText, thought: true }] : []), ...(outputText ? [{ text: outputText }] : [])],
			});
		}

		return contents;
	});
};

export default class GoogleAdaptor implements AiProvider {
	private client: GoogleGenAI;

	constructor(config: clientConfig) {
		this.client = new GoogleGenAI({ apiKey: config.apiKey });
	}

	protected normalizeRequestConfig(requestConfig: AiRequestConfig): GenerateContentParameters {
		const functionDeclarations: FunctionDeclaration[] =
			requestConfig.tools?.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parametersJsonSchema: tool.schema,
			})) ?? [];

		return {
			model: requestConfig.model,
			contents: normalizeGoogleContents(requestConfig.input),
			config: {
				thinkingConfig: {
					// Ask Gemini to include thought parts when the model supports
					// them, so the adapter can emit ThoughtEvent.
					includeThoughts: true,
				},
				tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
				toolConfig: functionDeclarations.length
					? {
							functionCallingConfig: {
								// AUTO lets the model choose between natural text
								// and function calls, matching the agent loop.
								mode: FunctionCallingConfigMode.AUTO,
							},
						}
					: undefined,
			},
		};
	}

	async *stream(requestConfig: AiRequestConfig): ReturnType<AiProvider['stream']> {
		const config = this.normalizeRequestConfig(requestConfig);
		const functionCalls: FunctionCall[] = [];

		try {
			const stream = await this.client.models.generateContentStream(config);

			for await (const chunk of stream) {
				const parts = chunk.candidates?.[0]?.content?.parts ?? [];

				for (const part of parts) {
					if (part.text) {
						// Gemini marks reasoning parts with `thought: true`.
						// Everything else is visible assistant output.
						yield {
							type: part.thought ? EventType.THOUGHT : EventType.OUTPUT,
							text: part.text,
						};
					}

					if (part.functionCall) {
						// Function calls are collected until the stream ends so
						// Agent can decide loop continuation after a full LLM turn.
						functionCalls.push(part.functionCall);
					}
				}

				if (!parts.length && chunk.functionCalls?.length) {
					// Some SDK response shapes expose function calls directly on
					// the chunk; keep this fallback for compatibility.
					functionCalls.push(...chunk.functionCalls);
				}
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
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield { type: EventType.AGENT_ERROR, message };
		}
	}
}
