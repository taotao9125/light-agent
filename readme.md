
https://github.com/user-attachments/assets/78560566-6359-4a48-9eb4-a407cd146afc

-----------------------


# TODO 

## 事件协议
- 生命周期事件统一从 agent emit 出来

## event 坐标定义更改
- `event(round, turn) => event(turn, step)`


### ---------------------- 以下记录下架构, 不稳定, 持续更新中 ----------------------

# light-agent 架构

`light-agent` 是一个基于事件流的 Agent Runtime。核心边界是：

- `Agent`：对外入口，负责会话、队列、上下文构建、事件持久化和工具注册表。
- `AgentLoop`：运行一次模型-工具循环，只做编排，不持有业务上下文。
- `ToolRegistry`：管理工具定义、参数校验、运行时上下文注入和 JSON Schema 暴露。
- `Vender.Adaptor`：模型厂商适配层，接收标准事件和标准工具 schema。
- `Context`：把 prompts、skills、历史事件压缩成模型输入。
- `Protocol`：定义 Agent 内部和外部观察到的事件结构。

## 顶层使用形态

```ts
import Agent from '@light-agent/agent';
import { createClient } from '@light-agent/ai';
import { builtinToolPrompts, createGrepTool, createReadFileTool, createTreeTool } from '@light-agent/agent/builtin-tools';
import { z } from 'zod';

const agent = new Agent({
	cwd: process.cwd(),
	venderAdaptor: createClient({
		name: 'openai',
		apiKey: process.env.OPENAI_API_KEY!,
		baseURL: 'https://api.openai.com/v1',
		model: 'gpt-4.1',
	}),
	context: {
		prompts: [builtinToolPrompts],
		skills: [],
	},
});

agent.tool.register(createTreeTool());
agent.tool.register(createGrepTool());
agent.tool.register(createReadFileTool());

agent.tool.register({
	name: 'weather',
	description: '获取指定城市的天气',
	schema: z.object({
		city: z.string().describe('城市名称，例如 London'),
	}),
	execute: async ({ city }, context) => {
		return {
			isError: false,
			content: `${city}: 晴`,
		};
	},
});

await agent.prompt('帮我查一下 London 的天气');
```

外部只通过 `agent.tool` 管理工具：

```ts
type AgentPublicAPI = {
	prompt(prompt: string): Promise<void>;
	interrupt(reason?: string): void;
	on(listener: AgentViewListener): () => void;
	getState(): {
		isRunning: boolean;
		queuedPrompts: number;
		currentWindowTokens: number;
		contextStrategyEnabled: boolean;
	};
	loadSession(): Promise<void>;
	tool: ToolRegistry;
};
```

## Agent

`Agent` 是宿主层入口。它拥有会话状态、工作目录、事件日志、工具注册表和 `AgentLoop`。

```ts
type AgentConfig = {
	cwd: string;
	session?: AgentSession;
	venderAdaptor: Vender.Adaptor;
	context: Context.Config;
	loop?: {
		retry?: Loop.RetryConfig;
	};
};

class Agent {
	public tool: ToolRegistry;

	prompt(prompt: string): Promise<void>;
	interrupt(reason?: string): void;
	on(listener: AgentViewListener): () => void;
	getState(): AgentState;
	loadSession(): Promise<void>;
}
```

职责：

- 使用 `p-queue` 串行处理用户 `prompt` 队列。
- 为当前运行中的 prompt 保留 `runningPromptAbortController`，用于 `interrupt()` 和工具执行期 `signal`。
- 持有 canonical event log，并把稳定事件写入 `AgentSession`。
- 在每次模型调用前调用 `contextBuilder` 生成上下文快照。
- 构造 `ToolRegistry`，并通过 `pullToolContext` 把 `cwd`、`signal` 注入工具执行期。

`Agent` 不直接执行工具。工具执行由 `AgentLoop` 通过 `ToolRegistry.get(name)` 完成。

## AgentLoop

`AgentLoop` 是模型-工具循环编排层。它不保存工作目录，不透传工具 context，只持有模型适配器和工具注册表。

```ts
namespace Loop {
	export type Config = {
		venderAdaptor: Vender.Adaptor;
		toolRegistry: ToolRegistry;
	};
}

type LoopDeps = {
	abortSignal: AbortSignal;
	pullContextSnap: () => Promise<Context.BuildResult>;
};

class AgentLoop {
	prompt(prompt: string, loopDeps: LoopDeps): Promise<void>;
	on(listener: (event: AgentEvent) => void): void;
	getVenderAdaptor(): Vender.Adaptor;
}
```

运行过程：

```ts
type LoopFlow =
	| 'emit input'
	| 'pull context snap'
	| 'vender.stream({ input, systemPrompt, tools })'
	| 'emit model events'
	| 'execute tool calls through toolRegistry'
	| 'emit tool results'
	| 'next turn or stop';
```

关键约束：

- `AgentLoop` 只把模型传来的 `args` 交给工具。
- 运行时上下文由 `ToolRegistry` 内部拉取。
- unknown tool、参数错误、工具执行错误都会形成 `Tool_Result`，返回给模型继续决策，而不是退出进程。

## Tool

工具定义以 zod object 为唯一输入 schema。`execute` 的参数类型由 `schema` 自动推导。

```ts
import { z } from 'zod';

type ToolSchema = z.ZodObject<z.ZodRawShape>;

type ToolContext = {
	cwd: string;
	signal?: AbortSignal;
};

type ToolResult = {
	isError: boolean;
	content: string;
};

type ToolDefinition<T extends ToolSchema = ToolSchema> = {
	name: string;
	description: string;
	schema: T;
	execute(args: z.infer<T>, context?: ToolContext): Promise<ToolResult>;
};
```

注册表示例：

```ts
agent.tool.register({
	name: 'read_file',
	description: '读取当前工作目录内的文件内容',
	schema: z.object({
		path: z.string().describe('相对于 cwd 的文件路径'),
	}),
	execute: async ({ path }, context) => {
		// context.cwd 由 Agent 创建 ToolRegistry 时统一注入
		return { isError: false, content: path };
	},
});
```

`ToolRegistry` 的公开接口：

```ts
class ToolRegistry {
	constructor(pullToolContext: () => ToolContext);

	register<T extends ToolSchema>(tool: ToolDefinition<T>): void;
	remove(name: string): boolean;
	get(name: string): ToolDefinition | undefined;
	getTools(): Array<{
		name: string;
		description: string;
		schema: { type: 'object' } & Record<string, unknown>;
	}>;
}
```

注册时校验：

```ts
type RegisterValidation =
	| 'name 必须是非空字符串'
	| 'description 必须是非空字符串'
	| 'schema 必须是 z.object'
	| 'name 不能重复';
```

执行时行为：

- 注册表会给工具对外 schema 增加 `_intent` 字段。
- `getTools()` 会把 zod schema 转成标准 JSON Schema，模型厂商适配层不感知 zod。
- 工具实际 `execute` 收到的 args 不包含 `_intent`。
- 模型传入的 args 会先经过原始 zod schema 校验；失败时返回可解释的错误内容，让模型重新决策。

## 内置工具

当前 `Agent` 只内置 runtime 级别的 `recall_indexed` 工具。文件探索类工具不再默认注册，需要调用方显式注册。

```ts
import { builtinToolPrompts, createGrepTool, createReadFileTool, createTreeTool } from '@light-agent/agent/builtin-tools';

const agent = new Agent({
	cwd: process.cwd(),
	venderAdaptor,
	context: {
		prompts: [builtinToolPrompts],
	},
});

agent.tool.register(createTreeTool());
agent.tool.register(createGrepTool());
agent.tool.register(createReadFileTool());
```

`tree -> grep -> read_file` 这类文件工具策略放在 `builtinToolPrompts` 中。只有注册了对应工具时，才应该把这段 prompt 传入 `context.prompts`。

路径相关工具必须经过统一路径校验：

```ts
type SafePathResult =
	| {
			ok: true;
			cwd: string;
			path: string;
			relativePath: string;
	  }
	| {
			ok: false;
			reason: 'path_escape' | 'path_not_found';
			content: string;
	  };

declare function validatePathInCwd(cwd: string, inputPath: string): Promise<SafePathResult>;
```

约束：

- 工具只能访问 `cwd` 内的路径。
- 路径不存在或路径逃逸时，工具返回 `content` 给模型重新决策。
- `grep` 基于仓库内置的 `rg` 二进制。
- `read_file` 会先判断文件大小，避免直接读取超大文件导致内存压力。

## Vender

模型厂商适配层只接收标准事件和标准 JSON Schema。

```ts
namespace Vender {
	export type ToolMeta = {
		name: string;
		description: string;
		schema: Record<string, unknown>;
	};

	export type StreamInput = {
		input: AgentEvent[];
		tools?: ToolMeta[];
		systemPrompt?: string;
	};

	export interface Adaptor {
		stream(input: StreamInput): AsyncIterable<AgentEvent>;
		_generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
	}
}
```

适配层职责：

- 把 `Vender.ToolMeta.schema` 适配成具体平台的 tool schema。
- 把平台流式输出转换成 `AgentEvent`。
- 把 token usage 转成 `AGENT_TRACE`。

适配层不应该依赖 zod，也不应该知道 `ToolRegistry` 的内部实现。

## Protocol

Agent Runtime 通过事件协议串联模型、工具、上下文和 UI。

```ts
type Meta = {
	roundId: string;
	turn: number;
};

type AgentEvent =
	| InputEvent
	| ThoughtEvent
	| ThoughtDeltaEvent
	| ToolCallsEvent
	| ToolResultEvent
	| OutputEvent
	| OutputDeltaEvent
	| AgentStop
	| TraceEvent
	| SummaryEvent;
```

工具调用事件：

```ts
type ToolCallsEvent = {
	type: 'tool_calls';
	tool_calls: {
		id: string;
		name: string;
		args: Record<string, unknown>;
	}[];
	meta?: Meta;
};

type ToolResultEvent = {
	type: 'tool_result';
	tool_result: {
		id: string;
		name: string;
		result: string;
		isError: boolean;
	};
	meta?: Meta;
};
```

事件流主路径：

```ts
type EventFlow = [
	'user input',
	'input',
	'thought | output | tool_calls',
	'tool_result',
	'thought | output | agent_stop',
];
```

## Context

上下文构建器把静态上下文和历史事件转换为模型输入。

```ts
namespace Context {
	export type Config = {
		prompts?: { name: string; content: string }[];
		skills?: string[];
		strategyEnabled?: boolean;
	};

	export type BuildResult = {
		events: AgentEvent[];
		systemPrompt: string;
		summaryEvent: SummaryEvent | null;
	};
}
```

职责：

- 把 `prompts` 组织进 system prompt。
- 把 `skills` 组织成可发现的 skill index。
- 根据历史事件和 token 使用情况决定是否压缩上下文。
- 必要时生成 `AGENT_SUMMARY`，由 `Agent` 写回 canonical event log。

`Context.BuildResult` 不携带 tools。工具列表由 `AgentLoop` 在调用模型时直接从 `ToolRegistry.getTools()` 获取。

## Session

Session 是 Agent 的外挂持久化能力。`Agent` 只依赖单个 `AgentSession`，不依赖 `SessionManager`。

```ts
type SessionStatus = 'idle' | 'running';

interface SessionMetadata {
	id: string;
	cwd: string;
	title?: string;
	createdAt: string;
	updatedAt: string;
	status: SessionStatus;
	metadata?: Record<string, unknown>;
}

interface AgentSession {
	readonly id: string;
	append(event: AgentEvent): Promise<void>;
	load(): Promise<AgentEvent[]>;
}

interface SessionManager {
	create(input: { cwd: string; title?: string; metadata?: Record<string, unknown> }): Promise<AgentSession>;
	open(sessionId: string): Promise<AgentSession>;
	openLatest(input?: { cwd?: string }): Promise<AgentSession | undefined>;
	list(input?: { cwd?: string; limit?: number }): Promise<SessionMetadata[]>;
	markRunning(sessionId: string): Promise<void>;
	markIdle(sessionId: string): Promise<void>;
}
```

宿主层负责 session 生命周期：

```ts
const session = await sessionManager.openLatest({ cwd }) ?? await sessionManager.create({ cwd });
const agent = new Agent({ cwd, session, venderAdaptor, context });

try {
	await sessionManager.markRunning(session.id);
	await agent.prompt(input);
} finally {
	await sessionManager.markIdle(session.id);
}
```

当前 `Agent` 会把这些事件写入 canonical log：

```ts
type CanonicalEvents =
	| 'input'
	| 'thought'
	| 'tool_calls'
	| 'tool_result'
	| 'output'
	| 'agent_stop'
	| 'agent_summary'
	| 'agent_trace';
```

## 分层依赖

```ts
type DependencyDirection = {
	agent: ['agentLoop', 'tool', 'context', 'session', 'protocol', 'ai'];
	agentLoop: ['tool', 'context types', 'protocol', 'ai'];
	tool: ['zod'];
	context: ['protocol', 'ai'];
	ai: ['protocol'];
	protocol: [];
	session: ['protocol'];
};
```

设计边界：

- `tool.ts` 不依赖厂商适配层。
- `Vender.Adaptor` 不依赖 zod。
- `AgentLoop` 不创建工具 map，也不透传 tool context。
- `Agent` 是运行时上下文和持久化边界。
- 工具 schema 在 `ToolRegistry` 内部从 zod 转成标准 JSON Schema，再交给厂商适配层。
