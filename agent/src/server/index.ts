import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import 'dotenv/config';

import AgentLoop from '../agent/agentLoop';
import type { SessionEvent } from '../agent/agent';
import AgentSession from '../agent/agent';
import SessionStore from '../agent/store';
import { createClient } from '../ai/index';
import toolRegistry from '../tools';

const PORT = Number(process.env.AGENT_WS_PORT ?? 8799);

if (process.env.HTTPS_PROXY) {
	setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}

type PromptClientMessage = {
	type: 'prompt';
	payload: {
		prompt?: string;
		input?: string;
	};
};

type PingClientMessage = {
	type: 'ping';
};

type InterruptClientMessage = {
	type: 'interrupt';
};

type ClientMessage = PromptClientMessage | PingClientMessage | InterruptClientMessage;

type ServerEvent =
	| { type: 'session_started'; sessionId: string }
	| { type: 'prompt_accepted'; sessionId: string }
	| { type: 'prompt_done'; sessionId: string }
	| { type: 'agent_event'; sessionId: string; event: SessionEvent }
	| { type: 'pong'; sessionId: string }
	| { type: 'server_error'; sessionId?: string; message: string };

function send(ws: WebSocket, event: ServerEvent) {
	if (ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify(event));
}

function parseClientMessage(raw: RawData): ClientMessage {
	const text = raw.toString();
	const message = JSON.parse(text) as Partial<ClientMessage>;

	if (message.type === 'ping') {
		return { type: 'ping' };
	}

	if (message.type === 'interrupt') {
		return { type: 'interrupt' };
	}

	if (message.type === 'prompt') {
		return {
			type: 'prompt',
			payload: {
				prompt: message.payload?.prompt,
				input: message.payload?.input,
			},
		};
	}

	throw new Error(`Unknown client message type: ${String(message.type)}`);
}

function getPromptText(message: PromptClientMessage): string {
	const text = message.payload.prompt ?? message.payload.input ?? '';
	return text.trim();
}

function createSession(sessionId: string) {
	const provider = createClient({
		vendorName: 'deepseek',
		apiKey: process.env.AI_DEEP_SEEK_API_KEY as string,
		baseURL: process.env.AI_DEEP_SEEK_API_HOST as string,
	});

	const agentLoop = new AgentLoop({
		provider,
		model: 'deepseek-v4-flash',
		tools: toolRegistry.getToolShapes(),
	});

	const store = new SessionStore({
		rootDir: path.resolve(process.cwd(), '.agent/sessions'),
	});

	return new AgentSession({
		agentLoop,
		sessionId,
		store,
	});
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
	const sessionId = `session_${randomUUID()}`;
	const session = createSession(sessionId);

	session.on((event) => {
		send(ws, {
			type: 'agent_event',
			sessionId,
			event,
		});
	});

	send(ws, {
		type: 'session_started',
		sessionId,
	});

	ws.on('error', (error) => {
		console.error('[ws:error]', error);
	});

	ws.on('message', async (raw) => {
		let message: ClientMessage;

		try {
			message = parseClientMessage(raw);
		} catch (error) {
			send(ws, {
				type: 'server_error',
				sessionId,
				message: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		if (message.type === 'ping') {
			send(ws, { type: 'pong', sessionId });
			return;
		}

		if (message.type === 'interrupt') {
			session.interrupt();
			return;
		}

		const prompt = getPromptText(message);
		if (!prompt) {
			send(ws, {
				type: 'server_error',
				sessionId,
				message: 'Prompt cannot be empty.',
			});
			return;
		}

		send(ws, {
			type: 'prompt_accepted',
			sessionId,
		});

		try {
			await session.prompt(prompt);
			send(ws, {
				type: 'prompt_done',
				sessionId,
			});
		} catch (error) {
			send(ws, {
				type: 'server_error',
				sessionId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
});

wss.on('listening', () => {
	console.log(`Agent WebSocket server listening on ws://localhost:${PORT}`);
});
