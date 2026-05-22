# Agent 工程师 1 个月冲刺计划

目标：1 个月后完成一个可展示、可讲清楚的 TypeScript Agent Runtime 项目，用来面试 Agent 工程岗位。

## 0. 最终交付

项目形态分两张图看：第一张是“模块归属”，第二张是“运行时通信”。不要把文件夹包含关系和调用关系混在同一个箭头里。

模块归属图：

```text
agent-runtime/
  src/
    cli/
      cli.ts                    # 终端入口

    server/
      websocket.ts              # WebSocket 入口

    protocol/
      events.ts                 # Input / Thought / Action / Observation / Output
      transport.ts              # ClientMessage / ServerEvent

    agent/
      Agent.ts                  # 会话门面 + loop 编排：prompt / on / event log
      AgentLoop.ts              # 可选拆分：input -> thought -> action -> observation -> output

    ai/
      AiProvider.ts             # provider 统一接口
      OpenAIProvider.ts         # OpenAI adapter
      DeepSeekProvider.ts       # DeepSeek adapter

    tools/
      Tool.ts                   # tool 接口
      ToolRegistry.ts           # name -> Tool
      builtins/readFile.ts
      searchDocs.ts             # RAG 暴露成 tool

    rag/
      chunk.ts
      embed.ts
      vectorStore.ts
      retriever.ts

    mcp/
      McpClient.ts
      McpToolAdapter.ts         # MCP tool -> 内部 Tool，加分项

    test/
      fakeProvider.ts
      AgentTestHarness.ts
```

运行时通信图：

```text
图例：
  -->  同进程函数调用
  ~~>  异步事件流 / AsyncIterable
  ==>  网络通信
  ..>  注册 / 适配，不是每次 prompt 都发生

CLI
  --> Agent.prompt(input)

WebSocket Client
  ==> WebSocket Server
  --> Agent.prompt(input)

Agent
  --> AiProvider.stream(eventLog, tools)
  --> ToolRegistry.get(action.name)
  --> Tool.execute(action.args, context)
  ~~> CLI Renderer / WebSocket Sender / Logger

Agent Event Log
  --> input -> thought -> action -> observation -> output

AiProvider Adapter
  --> normalize AgentEvent[] to vendor messages
  ==> OpenAI / DeepSeek API

search_docs Tool
  --> Retriever.search(query)
  --> VectorStore.search(embedding)

MCP Tool
  --> McpToolAdapter
  ==> MCP Server
  # 加分项，不阻塞 RAG / 测试主线

FakeProvider
  ..> 只在测试里替代真实 AiProvider
```

最终演示：

- CLI 输入 prompt，agent 能调用 tool。
- WebSocket 客户端能收到流式事件。
- 支持 OpenAI / DeepSeek 两个 provider。
- 支持本地 tool 和 RAG tool。
- 支持简单 RAG 检索。
- 加分项：支持 MCP tool adapter。
- 有 fake provider 测试 agent loop。

最终面试表达：

```text
我实现了一个 TypeScript Agent Runtime。
CLI 和 WebSocket 都不直接操作 provider/tool，而是通过 Agent.prompt()。
Agent 内部以 AgentEvent[] 作为事件日志，按 input -> thought -> action -> observation -> output 推进。
AiProvider adapter 负责把内部事件日志投影成厂商 messages，并把厂商 stream 规范化成内部事件。
本地工具和 RAG 工具都统一注册到 ToolRegistry；MCP tool adapter 可作为同一接口下的扩展。
测试里用 FakeProvider 模拟事件流，稳定验证 action、observation 和最终 output。
```

## 1. 总体架构

### 层级关系

```text
外部入口
  CLI
    -> 直接函数调用 Agent.prompt()

  WebSocket Client
    -> WebSocket JSON message
    -> WebSocket Server
    -> 函数调用 Agent.prompt()

核心运行时
  Agent
    -> 保存 AgentEvent[] 事件日志
    -> AsyncIterable 消费 AiProvider.stream()
    -> 函数调用 ToolRegistry.get()
    -> 函数调用 Tool.execute()
    -> callback 向外广播 AgentEvent
    -> 后续可拆出 AgentLoop / AgentManager，但内部状态仍以事件日志为准

AI 层
  AiProvider interface
    -> 输入 AgentEvent[] + ToolMeta[]
    -> OpenAIProvider 把事件日志投影成 OpenAI messages
    -> DeepSeekProvider 把事件日志投影成 DeepSeek/OpenAI-compatible messages

工具层
  ToolRegistry
    -> read_file 本地函数调用
    -> list_files 本地函数调用
    -> search_docs 调 Retriever
    -> MCP tool 调 MCP Client
```

### 通信方式总览

这里的“通信”分几类，不要混在一起看。

| 位置 | 通信方式 | 传输内容 | 为什么这样 |
|---|---|---|---|
| CLI -> Agent | 函数调用 | `prompt(text)` | 同进程，不需要网络协议 |
| WebSocket Client -> Server | WebSocket JSON | `ClientMessage` | 跨进程/前后端，需要网络双向通信 |
| WebSocket Server -> Agent | 函数调用 | `prompt(text)` / `abort()` | server 和 runtime 同进程 |
| Agent -> CLI/WebSocket | callback / Observer | `AgentEvent` | 一个 agent event 可以被 CLI、WebSocket、日志同时消费 |
| Agent 内部 | 事件日志 | `AgentEvent[]` | 统一记录 input/thought/action/observation/output |
| Agent -> AiProvider | `AsyncIterable` | `provider.stream({ input: AgentEvent[], tools })` | 模型输出是流式过程 |
| AiProvider Adapter -> 厂商协议 | 适配 / 投影 | `AgentEvent[] -> vendor messages` | 内部事件日志不泄漏厂商 messages 细节 |
| AiProvider -> 厂商 API | SDK / HTTP streaming | OpenAI/DeepSeek chunk | 厂商协议细节留在 adapter |
| Agent -> ToolRegistry | 函数调用 | `get(action.name)` | 本地运行时能力查找 |
| Agent -> Tool | 函数调用，返回 Promise | `execute(action.args, context)` | tool 是本地命令对象 |
| MCP Tool -> MCP Server | MCP transport，例如 stdio / HTTP / WebSocket | MCP tool call | 外部工具协议不泄漏到 Agent |
| RAG Tool -> Retriever | 函数调用 | `search(query, topK)` | RAG 是本地能力，作为 tool 暴露 |

### 总览时序图

这张图只描述一次 prompt 的主链路。它不表达文件夹归属，只表达运行时通信。

```text
User
  -> Entry: prompt
     Entry = CLI 或 WebSocket Server

Entry
  -> Agent: prompt(input)

Agent
  -> eventLog: append InputEvent
  -> AiProvider: stream({ input: eventLog, tools })

AiProvider Adapter
  -> vendor messages: normalize eventLog
  -> LLM API: SDK / HTTP streaming request
  <- AiProvider: vendor chunks normalized as Thought / Action / Output

Agent
  -> Output: emit AgentEvent
  -> User: terminal output or WebSocket ServerEvent

如果出现 action:
  Agent
    -> ToolRegistry/Tool: execute(action.args)
    <- ToolRegistry/Tool: result
    -> eventLog: append ObservationEvent
    -> AiProvider: continue with updated eventLog
```

### 两条主链路

#### CLI 链路

```text
用户输入
  -> CLI 读取 stdin
  -> agent.prompt(text)
  -> Agent append InputEvent
  -> provider.stream(eventLog)
  -> AgentEvent
  -> agent.emit(event)
  -> CLI renderer 输出到终端
```

#### WebSocket 链路

```text
浏览器 / ws-client
  -> WebSocket 发送 ClientMessage
  -> WebSocket server 解析 JSON
  -> agentManager.getOrCreate(sessionId)
  -> agent.prompt(text)
  -> Agent append InputEvent
  -> provider.stream(eventLog)
  -> agent.emit(event)
  -> WebSocket server 转成 ServerEvent
  -> ws.send(JSON.stringify(event))
```

### Action / Observation 链路

```text
AiProvider 产出 ActionEvent
  -> Agent 收到 action
  -> ToolRegistry.get(action.name)
  -> tool.execute(action.args, context)
  -> Agent 产出 ObservationEvent
  -> observation 追加到 AgentEvent[] 事件日志
  -> Agent 继续请求 provider
```

### RAG 链路

RAG 不直接插入 Agent，而是作为工具：

```text
模型决定调用 search_docs，provider 产出 ActionEvent
  -> Agent 执行 search_docs tool
  -> search_docs 调 Retriever.search(query)
  -> Retriever 调 Embedder.embed(query)
  -> VectorStore.search(embedding, topK)
  -> 返回 RetrievedChunk[]
  -> ObservationEvent 回填事件日志
```

### MCP 链路

MCP 也不直接插入 Agent，而是被 adapter 成内部 `Tool`：

```text
启动时
  MCP Client listTools()
  -> McpToolAdapter
  -> ToolRegistry.register(tool)

运行时
  模型产生 MCP tool 对应的 action
  -> Agent 查 ToolRegistry
  -> tool.execute(args)
  -> McpClient.callTool(name, args)
  -> MCP server 返回结果
  -> ObservationEvent 回填事件日志
```

### 数据流

```text
prompt
  -> Agent.prompt()
  -> append InputEvent
  -> provider.stream(eventLog)
  -> ThoughtEvent / ActionEvent / OutputEvent
  -> if action: ToolRegistry.get(name).execute(args)
  -> append ObservationEvent
  -> continue model loop
  -> emit events to CLI/WebSocket
```

### 核心原则

- CLI/WebSocket 只负责输入输出，不直接调用 provider/tool。
- Agent 负责事件日志、事件广播、中断和 loop 编排。
- AgentLoop 可以后续从 Agent 拆出，但仍以 AgentEvent[] 为输入输出。
- AiProvider 负责屏蔽厂商 SDK 差异，并把 AgentEvent[] 投影成厂商 messages。
- ToolRegistry 负责 name -> tool 的运行时注册和查找。
- RAG 作为 tool 接入；MCP 也按同样方式接入，但作为加分项，不阻塞主线。
- 测试优先用 FakeProvider，不依赖真实模型。

## 2. 核心接口契约

<details>
<summary>展开核心接口契约</summary>

这些接口是 4 周都围绕的主线。新协议以 `AgentEvent[]` 作为内部事实来源，不再把 OpenAI/DeepSeek 的 `messages` 作为核心领域模型。`messages` 只存在于 provider adapter 内部，属于厂商协议投影结果。

统一阅读口径：

- **位置**：这个接口属于哪一层。
- **上游**：谁把控制权或数据交给它。
- **下游**：它把控制权或数据交给谁。
- **输入**：它接收什么。
- **输出**：它产出什么。
- **通信方式**：函数调用、事件、AsyncIterable、WebSocket 等。
- **责任边界**：它不应该做什么。

### 2.1 入口协议

| 项 | 内容 |
|---|---|
| 位置 | WebSocket 入口协议层 |
| 上游 | WebSocket client |
| 下游 | WebSocket server，然后转给 Agent |
| 输入 | `ClientMessage` |
| 输出 | `ServerEvent` |
| 通信方式 | WebSocket JSON |
| 责任边界 | 只做网络协议转换，不直接调用 provider/tool |

```ts
export type ClientMessage =
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "abort"; sessionId: string };

export type ServerEvent =
  | { type: "session_started"; sessionId: string }
  | ({ sessionId: string } & AgentEvent);
```

### 2.2 Agent 门面 / 会话层

| 项 | 内容 |
|---|---|
| 位置 | CLI/WebSocket 共用的 runtime 门面 |
| 上游 | CLI 或 WebSocket server |
| 下游 | AiProvider、ToolRegistry、Tool；同时把 AgentEvent 发给 CLI/WebSocket/Logger |
| 输入 | 用户 prompt、abort 请求、初始化配置 |
| 输出 | AgentEvent、更新后的事件日志 |
| 通信方式 | 上游用函数调用；内部用 AsyncIterable 消费 provider；输出用 callback/EventEmitter |
| 责任边界 | 不处理厂商 SDK 细节，不实现具体 tool，不写 WebSocket 协议 |

```ts
export interface AgentOptions {
  id: string;
  cwd: string;
  provider: AiProvider;
  tools: ToolRegistry;
  model: string;
  maxTurns?: number;
  initialEvents?: AgentEvent[];
}

export class Agent {
  readonly id: string;

  onEvent(handler: (event: AgentEvent) => void): () => void;
  prompt(input: string): Promise<void>;
  abort(): void;
  getEvents(): AgentEvent[];
}
```

### 2.3 Agent 事件循环层

| 项 | 内容 |
|---|---|
| 位置 | Agent 核心循环层 |
| 上游 | Agent.prompt() |
| 下游 | AiProvider、ToolRegistry、Tool |
| 输入 | eventLog、provider、tools、cwd、signal |
| 输出 | AgentEvent；必要时追加 thought/action/observation/output |
| 通信方式 | Agent 内部 while loop；通过 AsyncIterable 消费 provider；函数调用 tool |
| 责任边界 | 不关心 CLI/WebSocket，不关心具体 provider SDK，不直接做 RAG/MCP 特判 |

```ts
export interface AgentLoopInput {
  events: AgentEvent[];
  provider: AiProvider;
  tools: ToolRegistry;
  model: string;
  cwd: string;
  maxTurns?: number;
  signal?: AbortSignal;
}

export async function* runAgentLoop(input: AgentLoopInput): AsyncIterable<AgentEvent>;
```

### 2.4 AI 层

| 项 | 内容 |
|---|---|
| 位置 | AI provider adapter 层 |
| 上游 | Agent |
| 下游 | OpenAI / DeepSeek 等厂商 SDK 或 HTTP API |
| 输入 | `AiRequest`：AgentEvent[]、tools、signal |
| 输出 | `AsyncIterable<AgentEvent>` |
| 通信方式 | Agent 用 AsyncIterable 消费；provider 内部用 SDK/HTTP streaming |
| 责任边界 | 不执行工具，不保存 session，不关心 CLI/WebSocket，只做 `AgentEvent[] -> vendor messages` 和 vendor chunks -> AgentEvent 的转换 |

```ts
export interface AiRequest {
  model: string;
  input: AgentEvent[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface AiProvider {
  name: string;
  stream(request: AiRequest): AsyncIterable<AgentEvent>;
}
```

### 2.5 工具层

| 项 | 内容 |
|---|---|
| 位置 | 工具能力层 |
| 上游 | Agent 根据 ActionEvent 查找工具 |
| 下游 | 本地函数、RAG Retriever、MCP Client |
| 输入 | tool name、args、ToolContext |
| 输出 | tool result |
| 通信方式 | ToolRegistry 用 Map 查找；Tool.execute 返回 Promise |
| 责任边界 | Tool 不直接调用模型，不管理事件日志；RAG/MCP 必须适配成 Tool，而不是侵入 Agent |

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: unknown;
  execute(args: unknown, context: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  list(): ToolDefinition[];
}
```

### 2.6 共享数据：AgentEvent

| 项 | 内容 |
|---|---|
| 位置 | runtime 内部事件日志 + 对外事件协议 |
| 上游 | Agent.prompt 添加 input；AiProvider 产生 thought/action/output；Agent 产生 observation/error/done |
| 下游 | AiProvider adapter、CLI renderer、WebSocket sender、Logger、测试 |
| 输入 | 用户输入、模型推理、工具请求、工具结果、最终输出、错误 |
| 输出 | 下一轮模型请求的上下文；UI/WebSocket/日志可消费的统一事件 |
| 通信方式 | 普通对象数组 + AsyncIterable + callback |
| 责任边界 | AgentEvent 是内部事实来源；厂商 messages 只是 adapter 的投影结果 |

```ts
export const EventType = {
  INPUT: "input",
  THOUGHT: "thought",
  ACTION: "action",
  OBSERVATION: "observation",
  OUTPUT: "output",
  AGENT_START: "agent_start",
  THOUGHT_START: "thought_start",
  THOUGHT_DONE: "thought_done",
  AGENT_DONE: "agent_done",
  AGENT_ERROR: "agent_error",
} as const;

export type AgentEvent =
  | { type: typeof EventType.INPUT; text: string; source?: "user" | "system" }
  | { type: typeof EventType.THOUGHT; text: string }
  | { type: typeof EventType.ACTION; id: string; name: string; args: Record<string, unknown> }
  | { type: typeof EventType.OBSERVATION; id: string; name: string; result: unknown }
  | { type: typeof EventType.OUTPUT; text: string }
  | { type: typeof EventType.AGENT_START }
  | { type: typeof EventType.THOUGHT_START }
  | { type: typeof EventType.THOUGHT_DONE }
  | { type: typeof EventType.AGENT_DONE }
  | { type: typeof EventType.AGENT_ERROR; message: string };
```

### 2.7 厂商 messages 投影

内部不定义 `Message` 作为主协议，但 provider adapter 可以把 `AgentEvent[]` 投影为厂商 messages。

```text
InputEvent       -> user/system message
ThoughtEvent     -> assistant reasoning_content / internal thought field
ActionEvent      -> assistant tool_calls
ObservationEvent -> tool message
OutputEvent      -> assistant content
```

这层是 Anti-Corruption Layer：OpenAI / DeepSeek 的 `role`、`tool_calls`、`tool_call_id`、`reasoning_content` 不应该扩散到 Agent/Tool/CLI。

</details>

## 3. 执行优先级

如果时间不够，按这个顺序保交付：

```text
P0：Agent + AgentEvent + AiProvider + ToolRegistry
P0：CLI demo 跑通 action -> observation -> output loop
P0：WebSocket 事件协议
P0：RAG search_docs tool
P0：FakeProvider 测试

P1：DeepSeek 第二 provider
P1：abort / timeout / traceId
P1：README + architecture.md + protocol.md

P2：MCP Tool Adapter
P2：更完整的错误恢复
P2：更漂亮的 CLI 输出
```

规则：

```text
P0 没完成，不做 P2。
MCP 卡住超过半天，就暂停，回到 RAG / 测试 / 文档。
```

## 4. 每日节奏

<details>
<summary>展开每日节奏</summary>

普通日：

```text
09:30 - 12:00  深度编码
12:00 - 14:00  吃饭 + 休息
14:00 - 16:30  学习 + 实现
16:30 - 17:00  复盘记录
19:30 - 21:00  面试表达 / 文档 / 简历
```

锻炼日：

```text
09:30 - 12:00  深度编码
12:00 - 13:30  吃饭
14:00 - 17:00  锻炼 / 外出
19:30 - 21:30  轻任务：文档、复盘、看源码
```

每日复盘：

```text
今天完成了什么：
遇到什么问题：
明天第一件事：
今天学到的架构点：
今天可用于面试表达的一句话：
```

</details>

## 5. 第 1 周：Agent Runtime 骨架

<details>
<summary>展开第 1 周详细计划</summary>

### 目标

把已有的 “SDK + tool call 实验代码” 改造成基于事件日志的分层 Agent Runtime。

### 交付模块

```text
src/protocol/events.ts
src/agent/Agent.ts
src/agent/AgentLoop.ts          # 后续可选拆分
src/ai/AiProvider.ts
src/ai/OpenAIProvider.ts
src/ai/DeepSeekProvider.ts
src/tools/Tool.ts
src/tools/ToolRegistry.ts
src/tools/builtins/readFile.ts
src/cli/cli.ts
```

### 本周完成标准

- `AgentEvent` 定义完成，覆盖 input / thought / action / observation / output。
- `AiProvider` 定义完成。
- `Tool` / `ToolRegistry` 定义完成。
- `Agent` 能处理一次 action -> observation -> 下一轮 output。
- `Agent.prompt()` 能驱动事件 loop。
- CLI 能跑通 `read_file`。

验收：

```text
CLI 输入：帮我读取 package.json
模型产出 ActionEvent(read_file)
tool result 回填 ObservationEvent
模型继续输出最终答案
```

### 借鉴 pi 的模式

| 模式 / 概念 | 解决的问题 | 你怎么用 |
|---|---|---|
| Facade | 入口层不应该知道内部复杂流程 | `Agent.prompt(input)` 包住事件日志、provider、tool loop |
| Event Log | runtime 需要统一历史和过程 | 用 `AgentEvent[]` 表达 input/thought/action/observation/output |
| Event Stream | 模型输出是过程，不是最终字符串 | provider stream 产出 Thought/Action/Output |
| Registry | 不要写 tool if/else | `ToolRegistry` 用 `Map<string, Tool>` |
| Command | tool call 是 name + args -> execute | 每个 tool 是 `{ name, execute }` |
| Pipeline | 输入到输出要分层流动 | input -> thought -> action -> observation -> output |
| Anti-Corruption Layer | 内部协议不要被 SDK 污染 | provider adapter 负责 AgentEvent[] -> vendor messages |

本周重点理解：

```text
CLI 不直接调用 provider。
Agent 内部不直接依赖具体 SDK message 结构。
Tool 不写中央 switch，注册到 ToolRegistry。
```

### 每日安排

第 1 天：

- 整理项目目录。
- 定义 `AgentEvent`、`EventType`、`AiProvider`、`Tool`。
- 明确内部事实来源是 `AgentEvent[]`，不再把 vendor `messages` 作为核心模型。
- 写 README 架构草图。

第 2 天：

- 实现 `ToolRegistry`。
- 实现 `read_file` 或 `list_files`。

第 3 天：

- 上午实现 `Agent` 基础 while loop。
- 支持 `input -> thought -> action -> observation -> output`。
- 下午锻炼。
- 晚上写事件 loop 设计笔记。

第 4 天：

- 实现 OpenAI 或 DeepSeek provider adapter。
- provider 输出统一 `AgentEvent`。
- adapter 负责 `AgentEvent[] -> vendor messages` 和 vendor chunks -> AgentEvent。

第 5 天：

- 实现 `Agent.prompt()` / `Agent.on()`。
- CLI 只创建 Agent、订阅事件、调用 `agent.prompt()`。

第 6 天：

- 锻炼。
- 修 bug。
- 补 README 架构图。

第 7 天：

- 集成 CLI demo。
- 写第 1 周复盘。

</details>

## 6. 第 2 周：WebSocket + 事件协议

<details>
<summary>展开第 2 周详细计划</summary>

### 目标

把 Agent Runtime 暴露成可被前端或其他服务调用的 WebSocket 服务。

### 交付模块

```text
src/protocol/transport.ts
src/server/websocket.ts
src/agent/AgentManager.ts
src/trace/trace.ts
scripts/ws-client.ts
```

### 接口契约

```ts
export type ClientMessage =
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "abort"; sessionId: string };

export type ServerEvent =
  | { type: "session_started"; sessionId: string }
  | ({ sessionId: string } & AgentEvent);

export class AgentManager {
  getOrCreate(sessionId: string): Agent;
  abort(sessionId: string): void;
  remove(sessionId: string): void;
}

export interface TraceContext {
  traceId: string;
  sessionId: string;
  startedAt: number;
}
```

### 本周完成标准

- WebSocket server 能启动。
- client 能发送 prompt。
- server 能推送 `input/thought/action/observation/output/agent_done/agent_error`。
- 支持 abort。
- 支持 timeout。
- 日志包含 `traceId` 和 `sessionId`。
- CLI 和 WebSocket 共用 `Agent`。

### 借鉴 pi 的模式

| 模式 / 概念 | 解决的问题 | 你怎么用 |
|---|---|---|
| Observer / Pub-Sub | 多个消费者要响应同一事件 | WebSocket 订阅 AgentEvent |
| Protocol Adapter | 内部事件和外部协议不同 | `AgentEvent` -> `ServerEvent` |
| Agent Manager | 多个会话需要管理 | `sessionId -> Agent` |
| Cancellation Boundary | 用户需要中断长任务 | `AbortController` 贯穿 Agent/provider/tool |
| Trace Context | 调试需要串起一次请求 | 每次 prompt 带 `traceId/sessionId` |

本周重点理解：

```text
WebSocket 不是新的 Agent。
WebSocket 只是协议层。
```

### 每日安排

第 8 天：

- 定义 `ClientMessage` / `ServerEvent`。
- 实现基础 WebSocket server。

第 9 天：

- WebSocket 接入 `Agent`。
- 推送 AgentEvent。

第 10 天：

- 上午实现 `AgentManager`。
- 下午锻炼。
- 晚上写协议文档草稿。

第 11 天：

- 实现 `abort`。
- 把 `AbortSignal` 传到 session/loop/provider。

第 12 天：

- 实现 timeout。
- 加 `traceId/sessionId` 日志。

第 13 天：

- 锻炼。
- 写 `scripts/ws-client.ts`。
- 修协议问题。

第 14 天：

- 集成 CLI + WebSocket。
- 写第 2 周复盘。

</details>

## 7. 第 3 周：RAG + MCP

<details>
<summary>展开第 3 周详细计划</summary>

### 目标

本周主线是 RAG。MCP 做最小 adapter，目标是证明“外部工具协议也能统一成内部 Tool”，不追求完整 MCP 平台能力。

核心目标：把 RAG 作为 tool 接入 Agent Runtime；MCP 最小 adapter 也遵循同一思路，但不侵入 Agent。

### 交付模块

```text
src/rag/chunk.ts
src/rag/embed.ts
src/rag/vectorStore.ts
src/rag/retriever.ts
src/tools/searchDocs.ts
src/mcp/McpClient.ts
src/mcp/McpToolAdapter.ts
```

### 接口契约

```ts
export interface DocumentChunk {
  id: string;
  source: string;
  text: string;
  startLine?: number;
  endLine?: number;
}

export interface RetrievedChunk extends DocumentChunk {
  score: number;
}

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  add(chunk: DocumentChunk, embedding: number[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<RetrievedChunk[]>;
}

export interface Retriever {
  search(query: string, topK: number): Promise<RetrievedChunk[]>;
}

export interface McpClient {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export function createSearchDocsTool(retriever: Retriever): Tool;
export function adaptMcpTool(client: McpClient, tool: McpToolInfo): Tool;
```

### 本周完成标准

必须完成：

- 加载 `docs/`。
- chunk 文档。
- embedding。
- 内存 vector store。
- `search_docs` tool。
- 回答带引用。

尽量完成：

- 连接一个 MCP server。
- MCP tool 转成内部 `Tool` 并注册。

### 借鉴 pi 的模式

| 模式 / 概念 | 解决的问题 | 你怎么用 |
|---|---|---|
| Adapter | 外部协议和内部接口不同 | MCP tool -> 内部 `Tool` |
| Repository / Store | 存储实现可能变化 | `VectorStore` 先内存，未来可换 DB |
| Tool as Capability | 外部能力统一成 tool | RAG 进 ToolRegistry，MCP 也按同样方式作为加分项接入 |
| Retrieval Pipeline | 检索流程要拆层 | load -> chunk -> embed -> search -> result |
| Boundary Isolation | Agent 不应知道 RAG/MCP 细节 | Agent 只执行 `ToolRegistry` 返回的 tool |

本周重点理解：

```text
RAG 最后应该变成 tool；MCP 如果做，也应该变成 tool。
Agent 不知道 tool 来自哪里。
```

### 每日安排

第 15 天：

- 实现文档加载。
- 实现 chunk。

第 16 天：

- 接 embedding。
- 实现内存 vector store。

第 17 天：

- 上午实现 retriever。
- 下午锻炼。
- 晚上写 RAG 数据流文档。

第 18 天：

- 实现 `search_docs` tool。
- agent 能主动调用检索工具。

第 19 天：

- 接 MCP client。
- 能列出 MCP server tools。

第 20 天：

- MCP tool adapter 成内部 `Tool`。
- 注册进 `ToolRegistry`。
- 如果 MCP 卡住，不继续深挖，先保证 RAG、测试和文档完成。

第 21 天：

- 集成 RAG demo。
- 如果 MCP 已完成，再补 MCP demo。
- 写第 3 周复盘。

</details>

## 8. 第 4 周：测试 + 文档 + 面试表达

<details>
<summary>展开第 4 周详细计划</summary>

### 目标

把项目打磨成能展示、能测试、能讲清楚的面试作品。

### 交付模块

```text
src/test/fakeProvider.ts
src/test/AgentTestHarness.ts
tests/agent-loop.test.ts
tests/tool-call.test.ts
tests/rag.test.ts
docs/architecture.md
docs/protocol.md
README.md
```

### 接口契约

```ts
export function createFakeProvider(events: AgentEvent[]): AiProvider {
  return {
    name: "fake",
    async *stream() {
      for (const event of events) yield event;
    },
  };
}

export interface AgentTestHarness {
  agent: Agent;
  prompt(input: string): Promise<AgentEvent[]>;
  events(): AgentEvent[];
}
```

### 本周完成标准

- FakeProvider。
- Agent loop 测试。
- Tool call 测试。
- RAG 测试。
- WebSocket demo。
- Abort 测试。
- README。
- `docs/architecture.md`。
- `docs/protocol.md`。
- 简历项目描述。
- 5 分钟项目讲解稿。

### 借鉴 pi 的模式

| 模式 / 概念 | 解决的问题 | 你怎么用 |
|---|---|---|
| Harness | agent 行为复杂，不能只靠手测 | `AgentTestHarness` |
| Deterministic Test Stream | 真实模型不稳定 | FakeProvider 固定产出事件 |
| Contract Test | 重点测层间契约 | 测 `AiProvider -> AgentEvent`、`Tool -> result` |
| Event Log Thinking | agent 行为通过事件观察 | 测试断言事件序列 |
| Documentation as Architecture | 架构要能被讲清楚 | `architecture.md` / `protocol.md` |

本周重点理解：

```text
优秀 agent 工程不能只靠真实模型手测。
要能用 fake provider 稳定复现 tool call、RAG、abort、error。
```

### 每日安排

第 22 天：

- 实现 FakeProvider。
- 写 Agent loop 测试。

第 23 天：

- 上午写 tool call 测试。
- 下午锻炼。
- 晚上修测试问题。

第 24 天：

- 写 RAG 测试。
- 写 WebSocket demo 脚本。

第 25 天：

- 写 `docs/architecture.md`。
- 画完整数据流。

第 26 天：

- 写 `docs/protocol.md`。
- 整理 WebSocket 消息协议。

第 27 天：

- 锻炼。
- 打磨 README。
- 准备 3 个 demo 命令。

第 28 天：

- 模拟面试讲解。
- 整理简历项目描述。
- 最终复盘。

</details>

## 9. 简历项目描述

```text
实现了一个 TypeScript Agent Runtime，支持 CLI/WebSocket 双入口、流式事件协议、多 Provider Adapter、Tool Registry、RAG 检索工具、会话中断和 Fake Provider 回归测试。
```

如果 MCP adapter 完成，再追加：

```text
额外实现 MCP Tool Adapter，将外部 MCP tools 统一适配为内部 ToolRegistry 可执行工具。
```

## 10. 当前不要做

- 不做复杂 UI。
- 不做完整权限系统。
- 不做复杂 planner。
- 不做企业级向量库。
- 不接十个 provider。
- 不深挖复杂 TS。
- 不复制大型仓库完整架构。

## 11. 每周复盘问题

<details>
<summary>展开每周复盘问题</summary>

```text
本周完成了哪些可演示能力？
哪一层的边界更清楚了？
哪个模块还说不清楚？
下周最重要的交付是什么？
简历上可以新增哪一句？
```

</details>
