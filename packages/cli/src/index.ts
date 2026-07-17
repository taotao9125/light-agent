#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Agent from '@light-agent/agent';
import FileSessionManager from '@light-agent/agent/session';
import { createClient } from '@light-agent/ai';
import { Box, render, Text, useApp, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';
import 'dotenv/config';

import type { AgentViewEvent } from '@light-agent/agent';
import type { AgentSession, SessionManager } from '@light-agent/agent/session';
import type { Vender } from '@light-agent/ai';

const h = React.createElement;

type Config = {
	API_KEY: string;
	API_HOST: string;
};

type Runtime = {
	agent: Agent;
	session: AgentSession;
	sessionManager: SessionManager;
};

type LogItem =
	| { type: 'info'; text: string }
	| { type: 'error'; text: string }
	| { type: 'thought'; text: string }
	| { type: 'output'; text: string }
	| { type: 'tool'; text: string };

const MIN_INPUT_WIDTH = 10;

function isConfig(value: unknown): value is Config {
	return (
		typeof value === 'object' &&
		value !== null &&
		'API_KEY' in value &&
		'API_HOST' in value &&
		typeof value.API_KEY === 'string' &&
		typeof value.API_HOST === 'string'
	);
}

async function loadConfig(): Promise<Config> {
	const configPath = path.join(os.homedir(), '.light-agent/config.json');
	const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
	if (!isConfig(config)) {
		throw new Error(`配置文件无效: ${configPath}`);
	}
	return config;
}

async function openSession(sessionManager: SessionManager, cwd: string) {
	const existingSession = await sessionManager.openLatest({ cwd });
	if (existingSession) return existingSession;

	return sessionManager.create({
		cwd,
		title: path.basename(cwd),
		metadata: { source: 'ink-cli' },
	});
}

function formatToolArgs(args: Record<string, unknown>) {
	const entries = Object.entries(args).filter(([key]) => key !== '_intent');
	if (!entries.length) return '';
	return entries
		.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
		.join(' ');
}

function formatToolLabel(name: string, id: string) {
	return `${name}#${id}`;
}

function formatToolError(result: string) {
	const text = result.trim();
	if (!text) return '';
	const firstLine = text.split('\n')[0];
	return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function appendLog(logs: LogItem[], item: LogItem) {
	return [...logs, item].slice(-80);
}

function appendStreamLog(logs: LogItem[], type: 'thought' | 'output', text: string) {
	const last = logs.at(-1);
	if (last?.type === type) {
		return [...logs.slice(0, -1), { type, text: `${last.text}${text}` }];
	}
	return appendLog(logs, { type, text });
}

function projectViewEvent(event: AgentViewEvent): LogItem | null {
	switch (event.type) {
		case 'agent_start':
			return { type: 'info', text: '开始执行 agent' };
		case 'tool_calls':
			return {
				type: 'tool',
				text: event.tool_calls
					.map((toolCall) => {
						const args = formatToolArgs(toolCall.args);
						const label = formatToolLabel(toolCall.name, toolCall.id);
						return args ? `tool: ${label} ${args}` : `tool: ${label}`;
					})
					.join('\n'),
			};
		case 'tool_results':
			return {
				type: 'tool',
				text: event.tool_results
					.map((toolResult) => {
						const label = formatToolLabel(toolResult.name, toolResult.id);
						if (!toolResult.isError) return `tool done: ${label}`;

						const message = formatToolError(toolResult.result);
						return message ? `tool error: ${label} ${message}` : `tool error: ${label}`;
					})
					.join('\n'),
			};
		case 'agent_stop':
			return {
				type: event.cause === 'llm' ? 'error' : 'info',
				text: `agent stopped (${event.cause}): ${event.message}`,
			};
		default:
			return null;
	}
}

function LogLine({ item }: { item: LogItem }) {
	const color = {
		info: 'gray',
		error: 'red',
		thought: 'gray',
		output: 'green',
		tool: 'yellow',
	}[item.type];

	return h(Text, { color }, item.text);
}

function PromptLine({ input, isReady, isRunning }: { input: string; isReady: boolean; isRunning: boolean }) {
	const { stdout } = useStdout();
	const columns = stdout.columns || 80;
	const prompt = isRunning ? 'running ' : '> ';
	const inputWidth = Math.max(MIN_INPUT_WIDTH, columns - prompt.length - 3);
	const visibleInput = input.length > inputWidth ? input.slice(-inputWidth) : input;
	const hiddenPrefix = input.length > inputWidth ? '…' : '';
	const cursor = isRunning ? ' ' : ' ';

	return h(
		Box,
		{ flexShrink: 0 },
		h(Text, { bold: true, color: isReady && !isRunning ? 'green' : 'gray' }, prompt),
		h(Text, { color: 'white', wrap: 'truncate-end' }, `${hiddenPrefix}${visibleInput}`),
		h(Text, { inverse: true, color: isReady && !isRunning ? 'green' : 'gray' }, cursor),
	);
}

function App() {
	const { exit } = useApp();
	const cwd = useMemo(() => process.cwd(), []);
	const [runtime, setRuntime] = useState<Runtime | null>(null);
	const [logs, setLogs] = useState<LogItem[]>([{ type: 'info', text: '正在启动 light-agent...' }]);
	const [input, setInput] = useState('');
	const [isRunning, setIsRunning] = useState(false);

	useEffect(() => {
		let disposed = false;

		async function boot() {
			try {
				const config = await loadConfig();
				const venderAdaptor: Vender.Adaptor = createClient({
					name: 'deepseek',
					apiKey: config.API_KEY,
					baseURL: config.API_HOST,
					model: 'deepseek-v4-flash',
				});
				const sessionManager = new FileSessionManager({
					rootDir: path.join(cwd, '.agent', 'sessions'),
				});
				const session = await openSession(sessionManager, cwd);
				const agent = new Agent({
					cwd,
					session,
					venderAdaptor,
					context: {},
				});

				await agent.loadSession();
				agent.on((event) => {
					setLogs((currentLogs) => {
						if (event.type === 'thought_delta') return appendStreamLog(currentLogs, 'thought', event.text);
						if (event.type === 'output_delta') return appendStreamLog(currentLogs, 'output', event.text);

						const logItem = projectViewEvent(event);
						return logItem ? appendLog(currentLogs, logItem) : currentLogs;
					});
				});

				if (!disposed) {
					setRuntime({ agent, session, sessionManager });
					setLogs([
						{ type: 'info', text: `cwd: ${cwd}` },
						{ type: 'info', text: `session: ${session.id}` },
					]);
				}
			} catch (error) {
				if (!disposed) {
					setLogs([{ type: 'error', text: error instanceof Error ? error.message : String(error) }]);
				}
			}
		}

		void boot();
		return () => {
			disposed = true;
		};
	}, [cwd]);

	async function submitPrompt(text: string) {
		if (!runtime || isRunning) return;

		setInput('');
		setIsRunning(true);
		setLogs((currentLogs) => appendLog(currentLogs, { type: 'info', text: `user: ${text}` }));

		await runtime.sessionManager.markRunning(runtime.session.id);
		try {
			await runtime.agent.prompt(text);
		} catch (error) {
			setLogs((currentLogs) =>
				appendLog(currentLogs, { type: 'error', text: error instanceof Error ? error.message : String(error) }),
			);
		} finally {
			await runtime.sessionManager.markIdle(runtime.session.id);
			setIsRunning(false);
		}
	}

	useInput((value, key) => {
		if (key.ctrl && value === 'c') {
			if (isRunning) {
				runtime?.agent.interrupt();
				return;
			}
			exit();
			return;
		}

		if (isRunning || !runtime) return;

		if (key.return) {
			const text = input.trim();
			if (text === 'exit' || text === 'quit') {
				exit();
				return;
			}
			if (text) void submitPrompt(text);
			return;
		}

		if (key.backspace || key.delete) {
			setInput((currentInput) => currentInput.slice(0, -1));
			return;
		}

		if (value && !key.ctrl && !key.meta) {
			setInput((currentInput) => `${currentInput}${value.replace(/\s*\r?\n\s*/g, ' ')}`);
		}
	});

	return h(
		Box,
		{ flexDirection: 'column' },
		h(
			Box,
			{ marginBottom: 1 },
			h(Text, { bold: true, color: 'cyan' }, 'light-agent'),
			h(Text, { color: 'gray' }, `  Ctrl+C ${isRunning ? '中断' : '退出'}，输入 exit 退出`),
		),
		h(
			Box,
			{ flexDirection: 'column', marginBottom: 1 },
			logs.map((item, index) => h(LogLine, { key: `${index}-${item.type}`, item })),
		),
		h(PromptLine, { input, isReady: !!runtime, isRunning }),
	);
}

render(h(App));
