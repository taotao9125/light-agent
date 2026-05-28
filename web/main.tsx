import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';

type Meta = {
	roundId: string;
	turn: number;
};

type SessionEvent =
	| { type: 'agent_start'; meta?: Meta }
	| { type: 'agent_done'; meta?: Meta }
	| { type: 'agent_error'; message: string; meta?: Meta }
	| { type: 'interrupt'; reason: string; meta?: Meta }
	| { type: 'input'; text: string; source?: 'user' | 'system'; meta?: Meta }
	| { type: 'thought_start'; meta?: Meta }
	| { type: 'thought_delta'; text: string; meta?: Meta }
	| { type: 'thought_done'; meta?: Meta }
	| { type: 'action_start'; id: string; name: string; args?: Record<string, unknown>; meta?: Meta }
	| { type: 'action_done'; id: string; name: string; meta?: Meta }
	| { type: 'output_start'; meta?: Meta }
	| { type: 'output_delta'; text: string; meta?: Meta }
	| { type: 'output_done'; meta?: Meta };

type ServerEvent =
	| { type: 'session_started'; sessionId: string }
	| { type: 'prompt_accepted'; sessionId: string }
	| { type: 'prompt_done'; sessionId: string }
	| { type: 'agent_event'; sessionId: string; event: SessionEvent }
	| { type: 'pong'; sessionId: string }
	| { type: 'server_error'; sessionId?: string; message: string };

type TimelineItem =
	| { id: string; kind: 'user'; text: string }
	| { id: string; kind: 'thought'; text: string; done: boolean }
	| { id: string; kind: 'output'; text: string; done: boolean }
	| { id: string; kind: 'tool'; name: string; args: Record<string, unknown>; status: 'running' | 'done' }
	| { id: string; kind: 'error'; text: string }
	| { id: string; kind: 'interrupt'; text: string };

const WS_URL = 'ws://localhost:8799';

function createItemId(prefix: string) {
	return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function metaKey(meta?: Meta) {
	if (!meta) return createItemId('event');
	return `${meta.roundId}:${meta.turn}`;
}

function appendToLastItem(items: TimelineItem[], kind: 'thought' | 'output', text: string) {
	const next = [...items];
	const last = next[next.length - 1];

	if (last?.kind === kind && !last.done) {
		next[next.length - 1] = {
			...last,
			text: last.text + text,
		};
		return next;
	}

	next.push({
		id: createItemId(kind),
		kind,
		text,
		done: false,
	});
	return next;
}

function upsertToolItem(items: TimelineItem[], tool: { id: string; name: string; args?: Record<string, unknown>; status: 'running' | 'done' }) {
	const next = [...items];
	const index = next.findIndex((item) => item.kind === 'tool' && item.id === tool.id);
	const args = tool.args ?? {};

	if (index === -1) {
		next.push({
			id: tool.id,
			kind: 'tool',
			name: tool.name,
			args,
			status: tool.status,
		});
		return next;
	}

	const current = next[index];
	if (current.kind !== 'tool') return next;

	next[index] = {
		...current,
		name: tool.name || current.name,
		args: Object.keys(args).length ? args : current.args,
		status: tool.status,
	};
	return next;
}

function App() {
	const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
	const [sessionId, setSessionId] = useState('');
	const [input, setInput] = useState('');
	const [items, setItems] = useState<TimelineItem[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const logRef = useRef<HTMLDivElement | null>(null);

	const canSend = status === 'connected' && input.trim().length > 0;
	const canStop = status === 'connected' && isRunning;

	const statusLabel = useMemo(() => {
		if (status === 'connected') return 'Connected';
		if (status === 'connecting') return 'Connecting';
		if (status === 'error') return 'Error';
		return 'Closed';
	}, [status]);

	useEffect(() => {
		const ws = new WebSocket(WS_URL);
		wsRef.current = ws;

		ws.addEventListener('open', () => setStatus('connected'));
		ws.addEventListener('close', () => setStatus('closed'));
		ws.addEventListener('error', () => setStatus('error'));
		ws.addEventListener('message', (event) => {
			const message = JSON.parse(event.data) as ServerEvent;
			handleServerEvent(message);
		});

		return () => {
			ws.close();
			wsRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!logRef.current) return;
		logRef.current.scrollTop = logRef.current.scrollHeight;
	}, [items]);

	function handleServerEvent(message: ServerEvent) {
		if (message.type === 'session_started') {
			setSessionId(message.sessionId);
			return;
		}

		if (message.type === 'server_error') {
			setItems((current) => [...current, { id: createItemId('error'), kind: 'error', text: message.message }]);
			setIsRunning(false);
			return;
		}

		if (message.type !== 'agent_event') return;

		const event = message.event;

		switch (event.type) {
			case 'agent_start':
				setIsRunning(true);
				break;

			case 'agent_done':
				setIsRunning(false);
				break;

			case 'input':
				setItems((current) => [...current, { id: metaKey(event.meta), kind: 'user', text: event.text }]);
				break;

			case 'thought_delta':
				setItems((current) => appendToLastItem(current, 'thought', event.text));
				break;

			case 'thought_done':
				setItems((current) => current.map((item) => item.kind === 'thought' && !item.done ? { ...item, done: true } : item));
				break;

			case 'output_delta':
				setItems((current) => appendToLastItem(current, 'output', event.text));
				break;

			case 'output_done':
				setItems((current) => current.map((item) => item.kind === 'output' && !item.done ? { ...item, done: true } : item));
				break;

			case 'action_start':
				setItems((current) => upsertToolItem(current, {
					id: event.id,
					name: event.name,
					args: event.args,
					status: 'running',
				}));
				break;

			case 'action_done':
				setItems((current) => current.map((item) => item.kind === 'tool' && item.id === event.id ? { ...item, status: 'done' } : item));
				break;

			case 'agent_error':
				setItems((current) => [...current, { id: createItemId('error'), kind: 'error', text: event.message }]);
				setIsRunning(false);
				break;

			case 'interrupt':
				setIsRunning(false);
				setItems((current) => [...current, { id: createItemId('interrupt'), kind: 'interrupt', text: event.reason || 'Interrupted by user.' }]);
				break;
		}
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const prompt = input.trim();
		if (!prompt || wsRef.current?.readyState !== WebSocket.OPEN) return;

		wsRef.current.send(JSON.stringify({
			type: 'prompt',
			payload: { prompt },
		}));

		setIsRunning(true);
		setInput('');
	}

	function handleStop() {
		if (!canStop || wsRef.current?.readyState !== WebSocket.OPEN) return;

		wsRef.current.send(JSON.stringify({
			type: 'interrupt',
		}));
		setIsRunning(false);
	}

	return (
		<main className="page">
			<section className="shell">
				<header className="topbar">
					<div>
						<h1>Agent Runtime</h1>
						<p>WebSocket demo for streaming session events.</p>
					</div>
					<div className="status">
						<span className={`dot dot-${status}`} />
						<span>{statusLabel}</span>
					</div>
				</header>

				<div className="session-row">
					<span>session</span>
					<code>{sessionId || 'waiting...'}</code>
				</div>

				<div ref={logRef} className="timeline">
					{items.length === 0 ? (
						<div className="empty">Send a prompt to start a session.</div>
					) : (
						items.map((item) => <TimelineCard key={item.id} item={item} />)
					)}
				</div>

				<form className="composer" onSubmit={handleSubmit}>
					<input
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="Ask the agent to inspect package.json..."
					/>
					<button type="button" className="stop-button" disabled={!canStop} onClick={handleStop}>Stop</button>
					<button type="submit" disabled={!canSend}>Send</button>
				</form>
			</section>
		</main>
	);
}

function TimelineCard({ item }: { item: TimelineItem }) {
	if (item.kind === 'user') {
		return (
			<article className="card user-card">
				<div className="label">user</div>
				<div>{item.text}</div>
			</article>
		);
	}

	if (item.kind === 'thought') {
		return (
			<article className="card thought-card">
				<div className="label">thinking {item.done ? 'done' : 'streaming'}</div>
				<div>{item.text}</div>
			</article>
		);
	}

	if (item.kind === 'output') {
		return (
			<article className="card output-card">
				<div className="label">output {item.done ? 'done' : 'streaming'}</div>
				{item.done ? (
					<MarkdownView text={item.text} />
				) : (
					<div className="stream-text">{item.text}</div>
				)}
			</article>
		);
	}

	if (item.kind === 'tool') {
		return (
			<article className="tool-row">
				<span className={`tool-state tool-${item.status}`} />
				<span className="tool-name">{item.name}</span>
				<code className="tool-args">{JSON.stringify(item.args ?? {})}</code>
				<span className="tool-status">{item.status}</span>
			</article>
		);
	}

	if (item.kind === 'interrupt') {
		return (
			<article className="card interrupt-card">
				<div className="label">interrupted</div>
				<div>{item.text}</div>
			</article>
		);
	}

	return (
		<article className="card error-card">
			<div className="label">error</div>
			<div>{item.text}</div>
		</article>
	);
}

function MarkdownView({ text }: { text: string }) {
	return (
		<div className="markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
		</div>
	);
}

createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
