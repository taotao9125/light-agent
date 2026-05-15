# 仓库历史里程碑与架构演进

本文从第一个提交开始，按“问题驱动”梳理这个仓库为什么会演进成现在的结构。

写法说明：

- 不按普通 changelog 罗列所有提交。
- 每个阶段都先写“当时会遇到什么问题”。
- 再用“如果不改，代码会长什么样”说明压力。
- 再列关键 commit。
- 最后用“改完后代码形态”说明架构如何变化。

当前 remote：

```text
https://github.com/earendil-works/pi
```

## 总演进图

```text
第 1 阶段：单仓库基建
  问题：后续会有 ai / tui / agent / cli / web 多个边界，单包会互相污染
  结果：npm workspaces + lockstep versioning

第 2 阶段：TUI 渲染
  问题：Agent 输出是流式过程，不是一次性 stdout
  结果：screen buffer + diff render + component TUI

第 3 阶段：AI provider
  问题：不同模型厂商协议差异大，agent loop 不能直接写 SDK 分支
  结果：packages/ai 统一 provider -> event stream

第 4 阶段：Web / browser
  问题：Node CLI 假设在浏览器不成立
  结果：storage adapter / runtime bridge / browser-safe 边界

第 5 阶段：Agent core
  问题：CLI / Web / RPC 都需要复用 agent loop
  结果：agent 包从产品入口中抽出

第 6 阶段：AgentSession
  问题：text/json/rpc/interactive 多入口不能各自维护 session 和运行逻辑
  结果：AgentSession 统一 prompt、事件、持久化、工具执行

第 7 阶段：Compaction
  问题：长期任务上下文会爆，简单截断又会丢任务状态
  结果：历史压缩 + 最近消息保真 + overflow recovery

第 8 阶段：Provider registry / lazy import
  问题：provider 数量增长后，静态 import 会拖慢启动并污染 browser 构建
  结果：注册表 + lazy loader + 用户 provider 覆盖

第 9 阶段：Extension runtime
  问题：hooks / skills / custom tools 分散实现会重复 discovery/context/权限
  结果：统一 extension runtime

第 10 阶段：Harness
  问题：agent 行为是状态机，不能只靠真实模型和手测
  结果：可控 faux provider / session / stream / resource 测试环境
```

## 阶段 1：为什么一开始就是 monorepo

### 问题

这个仓库从早期就不是一个简单 CLI。它需要同时承载：

- AI provider 抽象。
- TUI 渲染。
- Agent loop。
- Coding CLI。
- 后续 Web UI / browser runtime。

如果用单包，随着功能增长会出现这种代码形态：

```ts
// src/index.ts
import { OpenAI } from "openai";
import { renderTerminal } from "./tui";
import { runAgent } from "./agent";
import { saveSession } from "./session";
import { startWebUi } from "./web-ui";

export async function main() {
  // CLI 参数、AI 调用、TUI、session、web 入口混在一个包里
}
```

这种结构的实际问题：

- `ai` 的 provider 类型改动会直接影响 CLI 和 Web UI。
- TUI 的终端依赖会污染不需要 TUI 的包。
- CLI 想发布为产品，内部库又想被别的包复用。
- TypeScript build / exports 后补会非常痛。
- 多包互相依赖时没有清晰版本边界。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [a74c5da1](https://github.com/earendil-works/pi/commit/a74c5da1) | 初始 monorepo，npm workspaces，双 TypeScript 配置 | 先建立包边界，避免后面从单包硬拆。 |
| [f579a3f1](https://github.com/earendil-works/pi/commit/f579a3f1) | lockstep versioning | 多包强耦合阶段，用统一版本避免兼容性错配。 |
| [42bf7b4a](https://github.com/earendil-works/pi/commit/42bf7b4a) | husky pre-commit formatting/type checking | 多包仓库需要统一质量门禁。 |

### 改完后的代码形态

```text
packages/
  ai/             # 模型和 provider 协议
  tui/            # 终端 UI 渲染
  agent/          # agent loop 和工具编排
  coding-agent/   # CLI 产品入口
  web-ui/         # Web 入口
```

跨包依赖变成显式边界：

```ts
// packages/coding-agent/src/cli.ts
import { AgentSession } from "@earendil-works/pi-agent";

// packages/agent/src/agent-loop.ts
import { stream } from "@earendil-works/pi-ai";
```

问题被拆开了：

- CLI 只管入口。
- Agent 只管循环和工具。
- AI 只管 provider。
- TUI 只管终端渲染。

## 阶段 2：为什么 TUI 不能只是 `console.log`

### 问题

Agent CLI 的输出不是一次性结果，而是一个不断变化的过程：

- 模型 token 流式输出。
- tool call 需要插入运行状态。
- 输入框要保留。
- 状态栏要更新。
- 用户需要回看 scrollback。

如果用普通 stdout，代码会像这样：

```ts
for await (const chunk of modelStream) {
  process.stdout.write(chunk.text);
}

console.log("Running tool:", toolName);
console.log("Tool result:", result);
```

实际问题：

- tool 状态插入会打断模型文本。
- 用户输入和输出可能互相覆盖。
- 整屏重绘会破坏 scrollback。
- 复杂状态下无法局部更新。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [afa807b2](https://github.com/earendil-works/pi/commit/afa807b2) | `tui-double-buffer`，smart differential rendering，terminal abstraction | 避免每次整屏重绘。 |
| [0131b29b](https://github.com/earendil-works/pi/commit/0131b29b) | preserve scrollback | 避免 TUI 破坏终端历史。 |
| [386f90fc](https://github.com/earendil-works/pi/commit/386f90fc) | surgical differential rendering | 只更新变化区域。 |
| [97c730c8](https://github.com/earendil-works/pi/commit/97c730c8) | minimal TUI rewrite with differential rendering | 保留差量渲染核心，简化实现。 |
| [741add44](https://github.com/earendil-works/pi/commit/741add44) | refactor TUI into proper components | 终端界面组件化。 |

### 改完后的代码形态

TUI 不再直接输出字符串，而是维护 UI 状态：

```ts
type TuiState = {
  transcript: TranscriptItem[];
  input: string;
  status: "idle" | "thinking" | "running-tool";
  activeTool?: string;
};

function onAgentEvent(event: AgentEvent) {
  state = reduceTuiState(state, event);
  renderFrame(state);
}
```

渲染也不再是 `console.log`：

```ts
function renderFrame(state: TuiState) {
  const nextScreen = renderComponentTree(<App state={state} />);
  const patches = diffScreens(previousScreen, nextScreen);

  terminal.apply(patches);
  previousScreen = nextScreen;
}
```

这样解决的问题：

- 流式文本可以持续更新同一块区域。
- tool 状态可以独立渲染。
- 输入框不会被模型输出冲掉。
- scrollback 能被保护。

## 阶段 3：为什么 AI 包不能只是 OpenAI SDK wrapper

### 问题

最初调用模型可以很简单：

```ts
const client = new OpenAI({ apiKey });

const stream = await client.chat.completions.create({
  model,
  messages,
  stream: true,
});
```

但这个仓库很快要支持多个 provider。真实差异包括：

- OpenAI / Anthropic / Gemini 消息格式不同。
- tool schema 格式不同。
- tool call 可能分片输出。
- thinking / usage / stop reason 表达不同。
- 有的 provider 是 Chat Completions，有的是 Responses API。
- 有的 provider 是 API key，有的是 OAuth 或 ADC。

如果不抽象，agent loop 会变成：

```ts
async function runModel(provider: string, request: AgentRequest) {
  if (provider === "openai") {
    const stream = await openai.chat.completions.create(toOpenAI(request));
    return parseOpenAIStream(stream);
  }

  if (provider === "anthropic") {
    const stream = anthropic.messages.stream(toAnthropic(request));
    return parseAnthropicStream(stream);
  }

  if (provider === "gemini") {
    const stream = await gemini.generateContentStream(toGemini(request));
    return parseGeminiStream(stream);
  }
}
```

实际问题：

- 新增 provider 必须改 agent 主循环。
- tool call 解析分散在多个地方。
- UI / RPC 无法消费统一事件。
- provider 错误和 stop reason 无法统一处理。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [f064ea0e](https://github.com/earendil-works/pi/commit/f064ea0e) | 创建统一 AI package，支持 OpenAI / Anthropic / Gemini | provider 调用从应用层剥离。 |
| [e5aedfed](https://github.com/earendil-works/pi/commit/e5aedfed) | Anthropic Messages API provider | provider 差异进入 AI 层。 |
| [8364ecde](https://github.com/earendil-works/pi/commit/8364ecde) | OpenAI Completions and Responses providers | 同厂商不同 API 也隔离。 |
| [a8ba19f0](https://github.com/earendil-works/pi/commit/a8ba19f0) | Gemini provider with streaming/tools | tool calling 和 stream 差异被 provider 处理。 |
| [004de3c9](https://github.com/earendil-works/pi/commit/004de3c9) | new streaming generate API with `AsyncIterable` | 统一流式输出协议。 |
| [35fe8f21](https://github.com/earendil-works/pi/commit/35fe8f21) | tool validation with Zod | tool 参数结构化校验。 |
| [e8370436](https://github.com/earendil-works/pi/commit/e8370436) | replace Zod with TypeBox | tool schema 更贴近 JSON Schema。 |
| [39c626b6](https://github.com/earendil-works/pi/commit/39c626b6) | partial JSON parsing for streaming tool calls | 处理分片 tool 参数。 |
| [2296dc40](https://github.com/earendil-works/pi/commit/2296dc40) | typed errors and stop reasons | 统一错误和停止原因。 |

### 改完后的代码形态

Agent loop 面向统一 AI 接口：

```ts
for await (const event of stream({
  api,
  model,
  messages,
  tools,
})) {
  await handleAssistantEvent(event);
}
```

Provider 负责把厂商 chunk 归一化：

```ts
async function* streamOpenAI(options: StreamOptions) {
  const openaiStream = await client.chat.completions.create({
    ...toOpenAIParams(options),
    stream: true,
  });

  for await (const chunk of openaiStream) {
    yield* normalizeOpenAIChunk(chunk);
  }
}
```

Anthropic provider 也输出同一种事件：

```ts
async function* streamAnthropic(options: StreamOptions) {
  const anthropicStream = client.messages.stream(toAnthropicParams(options));

  for await (const event of anthropicStream) {
    yield* normalizeAnthropicEvent(event);
  }
}
```

上层不再关心底层 SDK：

```ts
type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "stop"; reason: StopReason };
```

问题被解决为：

- provider 差异只在 `packages/ai`。
- agent loop 只消费统一事件。
- TUI / RPC / JSON mode 可以共用事件协议。

## 阶段 4：为什么需要模型元数据和生成文件

### 问题

模型不是一个字符串。真实开发里需要知道：

- 哪个 provider。
- 是否支持 tools。
- context window 多大。
- 是否支持 thinking。
- token 成本。
- 默认模型应该是什么。

如果手写，代码会变成：

```ts
const MODELS = {
  "gpt-4.1": { provider: "openai", context: 1_000_000, tools: true },
  "claude-sonnet-4": { provider: "anthropic", context: 200_000, tools: true },
  "gemini-2.5-pro": { provider: "gemini", context: 1_000_000, tools: true },
  // 越来越多，人工维护容易错
};
```

实际问题：

- 模型列表增长快。
- provider 能力频繁变化。
- 手写容易漏工具能力、上下文长度、价格。
- CLI model selector 需要可靠数据。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [02a9b4f0](https://github.com/earendil-works/pi/commit/02a9b4f0) | models.dev integration | 模型数据从外部来源同步。 |
| [da66a97e](https://github.com/earendil-works/pi/commit/da66a97e) | autogenerated TypeScript models and factory | 用生成代码承载模型元数据。 |
| [c7618db3](https://github.com/earendil-works/pi/commit/c7618db3) | type-safe `createLLM` | 模型选择类型化。 |
| [9c3f32b9](https://github.com/earendil-works/pi/commit/9c3f32b9) | generated models with 181 tool-capable models | 大规模模型数据进入系统。 |
| [550da5e4](https://github.com/earendil-works/pi/commit/550da5e4) | cost tracking | 模型元数据开始服务成本统计。 |

### 改完后的代码形态

模型定义不再是散落常量，而是生成数据：

```ts
export type Model = {
  id: string;
  api: Api;
  contextWindow: number;
  supportsTools: boolean;
  inputTokenCost?: number;
  outputTokenCost?: number;
};
```

调用侧不再靠字符串猜 provider：

```ts
const model = resolveModel(modelId);

await stream({
  api: model.api,
  model: model.id,
  messages,
  tools: model.supportsTools ? tools : undefined,
});
```

CLI selector 也可以基于能力过滤：

```ts
const candidates = models.filter(model => {
  return model.supportsTools && model.contextWindow >= requiredContext;
});
```

## 阶段 5：为什么 Web / browser 会逼出 runtime 边界

### 问题

CLI 默认能用 Node 能力：

```ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

await readFile(path, "utf8");
spawn(command, args);
```

但 Web / browser 环境不能使用：

- `node:fs`
- `node:child_process`
- 本地 shell
- 一些 Node-only provider SDK

如果 Web UI 直接 import Node 入口，会出现类似你之前遇到的错误：

```text
Module "node:child_process" has been externalized for browser compatibility.
Cannot access "node:child_process.spawn" in client code.
```

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [b67c10df](https://github.com/earendil-works/pi/commit/b67c10df) | cross-browser extension with AI reading assistant | Agent 能力进入浏览器场景。 |
| [f2eecb78](https://github.com/earendil-works/pi/commit/f2eecb78) | add web-ui package | Web UI 成为独立入口。 |
| [04966513](https://github.com/earendil-works/pi/commit/04966513) | prompt caching, pluggable storage, CORS proxy | 浏览器场景需要缓存、存储、跨域处理。 |
| [e5cf25a2](https://github.com/earendil-works/pi/commit/e5cf25a2) | refactor agent architecture and add session storage | session/storage 开始从环境里抽象出来。 |
| [05dfaa11](https://github.com/earendil-works/pi/commit/05dfaa11) | custom message extension system | Web 输出需要 typed renderer。 |
| [bbbc232c](https://github.com/earendil-works/pi/commit/bbbc232c) | unified storage architecture | 多运行时统一 storage 接口。 |
| [c2793d80](https://github.com/earendil-works/pi/commit/c2793d80) | runtime bridge for artifacts and REPL | UI 和执行环境隔离。 |

### 改完后的代码形态

不能让业务代码直接依赖 Node：

```ts
// 不适合 browser 复用
export class NodeExecutionEnv {
  async run(command: string, args: string[]) {
    return spawn(command, args);
  }
}
```

需要抽象环境能力：

```ts
export interface ExecutionEnv {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  runCommand(command: string, args: string[]): Promise<CommandResult>;
}
```

Node CLI 注入 Node 实现：

```ts
const session = new AgentSession({
  executionEnv: new NodeExecutionEnv(process.cwd()),
  storage: new FileSessionStorage(configDir),
});
```

Web UI 注入 browser-safe 实现或 bridge：

```ts
const session = new AgentSession({
  executionEnv: new BrowserRuntimeBridge(worker),
  storage: new IndexedDbSessionStorage(),
});
```

问题被解决为：

- `agent` 核心依赖接口。
- `coding-agent` CLI 提供 Node 实现。
- `web-ui` 提供 browser/bridge 实现。
- Node-only 代码不能泄漏进 browser bundle。

## 阶段 6：为什么 Agent 要从 CLI 里抽出来

### 问题

如果 agent loop 写在 CLI 文件里，会自然变成：

```ts
async function main() {
  const args = parseArgs(process.argv);
  const messages = await loadMessages(args);

  for await (const event of stream({ model: args.model, messages })) {
    if (event.type === "tool_call") {
      const result = await runTool(event);
      messages.push(result);
      continue;
    }

    renderToTerminal(event);
  }

  await saveSession(messages);
}
```

实际问题：

- Web UI 想复用 agent loop，很难。
- RPC 想复用 agent loop，很难。
- tool orchestration 和 terminal rendering 耦合。
- session 保存和 CLI 参数耦合。
- 测试只能跑完整 CLI。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [ffc9be88](https://github.com/earendil-works/pi/commit/ffc9be88) | Agent package + coding agent WIP | agent 核心开始独立成包。 |
| [92bad861](https://github.com/earendil-works/pi/commit/92bad861) | remove `agent-old` | 旧 agent 结构被清理。 |
| [95d04019](https://github.com/earendil-works/pi/commit/95d04019) | model selector TUI and session management | CLI 开始成为产品入口，而不只是调用模型。 |
| [458702b3](https://github.com/earendil-works/pi/commit/458702b3) | `--resume` and session selector | session 进入主工作流。 |
| [812f2f43](https://github.com/earendil-works/pi/commit/812f2f43) | defer session creation | session 生命周期被精确化。 |
| [dca3e1cc](https://github.com/earendil-works/pi/commit/dca3e1cc) | hierarchical context file loading | monorepo 上下文按目录加载。 |
| [b1c2c32e](https://github.com/earendil-works/pi/commit/b1c2c32e) | move context files to system prompt | 项目规则进入 system prompt。 |

### 改完后的代码形态

CLI 只负责入口：

```ts
async function main(argv: string[]) {
  const args = parseArgs(argv);
  const session = await createCliSession(args);

  await runInteractiveMode(session);
}
```

Agent core 负责循环：

```ts
export async function runAgentLoop(state: AgentState) {
  while (!state.done) {
    const stream = await callModel(state);

    for await (const event of stream) {
      if (event.type === "tool_call") {
        await executeToolAndAppendResult(state, event);
      } else {
        state.emit(event);
      }
    }
  }
}
```

这样 CLI / RPC / Web 可以复用同一个 agent loop：

```ts
// CLI
await session.prompt(input);

// RPC
await rpcSession.prompt(request.text);

// Web
await browserSession.prompt(editorInput);
```

## 阶段 7：为什么需要 AgentSession

### 问题

当 CLI 出现多个模式时：

- interactive mode。
- `--mode text`。
- `--mode json`。
- `--mode rpc`。
- resume。
- export。
- branch。

如果每个入口自己维护状态，会变成：

```ts
async function runTextMode() {
  const history = await loadHistory();
  const result = await runAgent(history);
  await saveHistory(history);
  printText(result);
}

async function runJsonMode() {
  const history = await loadHistory();
  const result = await runAgent(history);
  await saveHistory(history);
  printJson(result);
}

async function runRpcMode() {
  const history = await loadHistory();
  const result = await runAgent(history);
  await saveHistory(history);
  sendRpcEvents(result);
}
```

实际问题：

- session 保存时机容易不一致。
- tool 执行事件容易不一致。
- compaction 只在某些 mode 生效。
- queue/model/thinking 状态重复实现。
- RPC 和 interactive 行为可能分叉。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [68092ccf](https://github.com/earendil-works/pi/commit/68092ccf) | `--mode text/json/rpc` | CLI 变成多入口。 |
| [9e3e319f](https://github.com/earendil-works/pi/commit/9e3e319f) | session export HTML and RPC docs | session 成为可导出对象。 |
| [1507f8b7](https://github.com/earendil-works/pi/commit/1507f8b7) | coding-agent refactoring plan | 大重构前先定义拆分方案。 |
| [29d96ab2](https://github.com/earendil-works/pi/commit/29d96ab2) | WP2 AgentSession basic structure | 统一 session facade。 |
| [eba196f4](https://github.com/earendil-works/pi/commit/eba196f4) | WP3 event subscription and persistence | session 变成事件源并负责持久化。 |
| [d08e1e53](https://github.com/earendil-works/pi/commit/d08e1e53) | WP4 prompting methods | prompt 入口进入 session。 |
| [0119d761](https://github.com/earendil-works/pi/commit/0119d761) | WP5/WP6 model, thinking, queue mode | session 管理运行状态。 |
| [8d6d2dd7](https://github.com/earendil-works/pi/commit/8d6d2dd7) | WP7 compaction | compaction 进入 session。 |
| [94ff0b09](https://github.com/earendil-works/pi/commit/94ff0b09) | WP8 bash execution | 工具执行进入 session orchestration。 |
| [e7c71e7e](https://github.com/earendil-works/pi/commit/e7c71e7e) | WP12 RPC mode using AgentSession | RPC 复用 session。 |
| [e9f6de7c](https://github.com/earendil-works/pi/commit/e9f6de7c) | WP14 new CLI using AgentSession | CLI 切换到 session。 |
| [0020de85](https://github.com/earendil-works/pi/commit/0020de85) | WP15 InteractiveMode using AgentSession | interactive 复用 session。 |
| [3559a43b](https://github.com/earendil-works/pi/commit/3559a43b) | typed RPC protocol and client | RPC 协议类型化。 |

### 改完后的代码形态

多入口不再各自跑 agent，而是共用 AgentSession：

```ts
const session = await AgentSession.open({
  cwd,
  model,
  storage,
  tools,
});

session.on("event", event => {
  output.write(event);
});

await session.prompt(userInput);
```

不同 mode 只换 output adapter：

```ts
const output =
  mode === "json" ? new JsonOutput() :
  mode === "rpc" ? new RpcOutput(client) :
  mode === "text" ? new TextOutput() :
  new TuiOutput();

session.on("event", event => output.write(event));
```

AgentSession 内部统一处理：

```ts
class AgentSession {
  async prompt(input: string) {
    this.queue.push(input);
    await this.persist();

    for await (const event of runAgentLoop(this.state)) {
      this.emit(event);
      await this.persistEvent(event);
    }
  }
}
```

问题被解决为：

- CLI / RPC / interactive 不再各自维护 agent 主循环。
- session persistence 统一。
- compaction 统一。
- tool execution 统一。
- 输出只是 adapter 差异。

## 阶段 8：为什么需要 Compaction

### 问题

Coding agent 的上下文增长很快：

```text
用户需求
  + 读取文件 A/B/C
  + 命令输出
  + 错误日志
  + 修改方案
  + 测试结果
  + 用户追问
  + 更多文件
```

如果全部保留：

```ts
messages.push(...allToolResults);
messages.push(...allAssistantEvents);
messages.push(newUserMessage);

await stream({ messages });
```

实际问题：

- token 成本上涨。
- 请求变慢。
- 超出 context window 后直接失败。

如果简单截断：

```ts
messages = messages.slice(-20);
```

又会产生新问题：

- 忘记用户最初目标。
- 忘记已经修改过哪些文件。
- 忘记失败过的方案。
- tool result 和后续推理断裂。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [5daef11b](https://github.com/earendil-works/pi/commit/5daef11b) | compaction research and plan | 先把长上下文作为架构问题分析。 |
| [50b334f8](https://github.com/earendil-works/pi/commit/50b334f8) | compaction examples and branch interaction | compaction 和 session/branch 工作流关联。 |
| [1c18b800](https://github.com/earendil-works/pi/commit/1c18b800) | auto-compaction trigger flow | 自动触发压缩。 |
| [6c2360af](https://github.com/earendil-works/pi/commit/6c2360af) | context compaction core logic | 压缩核心逻辑落地。 |
| [79731249](https://github.com/earendil-works/pi/commit/79731249) | commands, auto-trigger, RPC support | CLI/RPC 都支持 compaction。 |
| [c89b1ec3](https://github.com/earendil-works/pi/commit/c89b1ec3) | `/compact`, `/autocompact`, auto trigger | 用户手动和系统自动结合。 |
| [a38e6190](https://github.com/earendil-works/pi/commit/a38e6190) | overflow recovery | 已经溢出时也有恢复路径。 |
| [5a9d844f](https://github.com/earendil-works/pi/commit/5a9d844f) | simplify compaction with `Agent.continue` retry | 恢复逻辑收敛到 continuation。 |

### 改完后的代码形态

不是截断，而是把老历史压缩成状态摘要：

```ts
async function maybeCompact(session: AgentSession) {
  if (countTokens(session.messages) < session.compactionThreshold) {
    return;
  }

  const oldMessages = session.messages.slice(0, -RECENT_MESSAGE_COUNT);
  const recentMessages = session.messages.slice(-RECENT_MESSAGE_COUNT);

  const summary = await summarizeOldContext(oldMessages);

  session.messages = [
    session.systemPrompt,
    {
      role: "system",
      content: formatCompactionSummary(summary),
    },
    ...recentMessages,
  ];

  await session.persist();
}
```

模型调用前统一检查：

```ts
async function runTurn(session: AgentSession, input: string) {
  await maybeCompact(session);

  try {
    await session.continue(input);
  } catch (error) {
    if (isContextOverflow(error)) {
      await forceCompact(session);
      await session.continue(input);
    }
  }
}
```

问题被解决为：

- 不丢最近关键细节。
- 老历史变成任务状态摘要。
- 上下文溢出有恢复路径。
- CLI 和 RPC 都走同一套压缩逻辑。

## 阶段 9：为什么 provider 要注册，还要 lazy import

### 问题

provider 数量越来越多后，如果全部静态 import：

```ts
import { streamOpenAI } from "./providers/openai";
import { streamAnthropic } from "./providers/anthropic";
import { streamGemini } from "./providers/gemini";
import { streamVertex } from "./providers/vertex";
import { streamCopilot } from "./providers/copilot";

export const providers = {
  openai: streamOpenAI,
  anthropic: streamAnthropic,
  gemini: streamGemini,
  vertex: streamVertex,
  copilot: streamCopilot,
};
```

实际问题：

- 用户只用 DeepSeek，也要加载 OpenAI / Anthropic / Vertex。
- Node-only provider 会被 Vite/browser 扫到。
- 某个 provider 的可选依赖失败，会影响整个包。
- 用户自定义 provider 很难覆盖内置 provider。
- OAuth / ADC / API key 的初始化逻辑会污染启动流程。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [0c5cbd00](https://github.com/earendil-works/pi/commit/0c5cbd00) | custom models/providers via `models.json` | 用户可添加 provider。 |
| [587d7c39](https://github.com/earendil-works/pi/commit/587d7c39) | Anthropic OAuth | 认证方式开始复杂化。 |
| [243104fa](https://github.com/earendil-works/pi/commit/243104fa) | custom providers override built-ins | 用户 provider 可以覆盖内置 provider。 |
| [214e7dae](https://github.com/earendil-works/pi/commit/214e7dae) | Vertex AI with ADC | 云平台 ADC 进入 provider。 |
| [b66157c6](https://github.com/earendil-works/pi/commit/b66157c6) | GitHub Copilot support | 非传统 provider 进入系统。 |
| [1650041a](https://github.com/earendil-works/pi/commit/1650041a) | OpenAI Codex OAuth and Responses provider | OAuth + Responses API 复杂度进入 provider。 |
| [edb0da96](https://github.com/earendil-works/pi/commit/edb0da96) | provider `sessionId` for caching | provider 开始利用 session 级缓存。 |

### 改完后的代码形态

注册的不是 provider 实现，而是 provider loader：

```ts
type ApiProvider = {
  stream(options: StreamOptions): AssistantMessageEventStream;
};

const registry = new Map<string, () => Promise<ApiProvider>>();

export function registerApiProvider(
  api: string,
  loader: () => Promise<ApiProvider>,
) {
  registry.set(api, loader);
}
```

调用时才加载：

```ts
export async function stream(options: StreamOptions) {
  const loadProvider = registry.get(options.api);

  if (!loadProvider) {
    throw new Error(`Unknown provider: ${options.api}`);
  }

  const provider = await loadProvider();
  return provider.stream(options);
}
```

内置 provider 可以 lazy：

```ts
registerApiProvider("deepseek", async () => {
  const provider = await loadDeepSeekProvider();
  return {
    stream: provider.streamDeepSeek,
  };
});
```

用户 provider 可以覆盖：

```ts
for (const customProvider of modelsJson.providers) {
  registerApiProvider(customProvider.api, async () => {
    return createOpenAICompatibleProvider(customProvider);
  });
}
```

问题被解决为：

- 不使用的 provider 不加载。
- browser-safe 入口不被 Node-only provider 污染。
- 用户 provider 可以覆盖内置 provider。
- provider 认证细节留在 provider 内部。

## 阶段 10：为什么 hooks / skills / custom tools 最后要合并成 extension runtime

### 问题

扩展能力最开始可以分别做：

```ts
loadHooks();
loadSkills();
loadCustomTools();
loadShortcuts();
```

但这些能力很快会重复处理同一批问题：

- 从哪里发现配置。
- 如何拿到 session。
- 如何拿到 cwd / env / model。
- 如何控制 tool availability。
- 如何订阅事件。
- 如何处理权限。
- 如何处理加载顺序。

分散实现会变成：

```ts
const hooks = await discoverHooks(config);
const skills = await discoverSkills(config);
const tools = await discoverTools(config);

for (const hook of hooks) {
  hook.setup({ session, cwd, env });
}

for (const skill of skills) {
  skill.setup({ session, cwd, env });
}

for (const tool of tools) {
  tool.setup({ session, cwd, env });
}
```

实际问题：

- context 构造重复。
- 权限逻辑重复。
- 生命周期重复。
- 扩展之间通信困难。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [04d59f31](https://github.com/earendil-works/pi/commit/04d59f31) | hooks system | 生命周期扩展点出现。 |
| [7c553acd](https://github.com/earendil-works/pi/commit/7c553acd) | hooks with `pi.send` | hook 可以向运行时发事件。 |
| [09bca967](https://github.com/earendil-works/pi/commit/09bca967) | Claude Code-compatible skills | skill 作为工作流扩展出现。 |
| [3b2b9abf](https://github.com/earendil-works/pi/commit/3b2b9abf) | `SKILL.md` convention | skill 发现约定出现。 |
| [e707ac4c](https://github.com/earendil-works/pi/commit/e707ac4c) | skills API export and auto-discovery | skills 变成 API。 |
| [e7097d91](https://github.com/earendil-works/pi/commit/e7097d91) | custom tools with session lifecycle | 用户工具接入 session。 |
| [9c9e6822](https://github.com/earendil-works/pi/commit/9c9e6822) | event bus | hook/tool 通信解耦。 |
| [c956a726](https://github.com/earendil-works/pi/commit/c956a726) | hook API for CLI flags, shortcuts, tool control | hooks 影响产品行为。 |
| [2846c7d1](https://github.com/earendil-works/pi/commit/2846c7d1) | unified extensions system, not wired | 统一扩展抽象出现。 |
| [9794868b](https://github.com/earendil-works/pi/commit/9794868b) | extension discovery with package manifest | manifest 发现机制出现。 |
| [c6fc0845](https://github.com/earendil-works/pi/commit/c6fc0845) | merge hooks and custom-tools into unified extensions | hooks/custom tools 合并。 |
| [cb3ac0ba](https://github.com/earendil-works/pi/commit/cb3ac0ba) | simplify extension runtime architecture | 合并后继续简化 runtime。 |
| [b1fb9106](https://github.com/earendil-works/pi/commit/b1fb9106) | unify tool/event handler context creation | handler context 统一。 |

### 改完后的代码形态

扩展统一从 manifest 发现：

```ts
type ExtensionManifest = {
  name: string;
  hooks?: HookDefinition[];
  tools?: ToolDefinition[];
  skills?: SkillDefinition[];
};

const manifests = await discoverExtensionManifests(extensionDirs);
```

统一创建运行时上下文：

```ts
function createExtensionContext(session: AgentSession): ExtensionContext {
  return {
    cwd: session.cwd,
    env: session.env,
    sessionId: session.id,
    events: session.eventBus,
    tools: session.toolRegistry,
  };
}
```

统一注册：

```ts
for (const extension of extensions) {
  const context = createExtensionContext(session);

  for (const hook of extension.hooks) {
    session.hooks.register(hook, context);
  }

  for (const tool of extension.tools) {
    session.tools.register(tool, context);
  }

  for (const skill of extension.skills) {
    session.skills.register(skill, context);
  }
}
```

问题被解决为：

- discovery 统一。
- context 统一。
- 生命周期统一。
- tool/hook/skill 可以共享 event bus。
- 扩展能力不再散落在多个加载器里。

## 阶段 11：为什么需要 Harness

### 问题

Agent 不是纯函数。一次 turn 里可能发生：

- 读取 resource。
- 调模型 stream。
- 触发 tool call。
- 写 session。
- 做 compaction。
- 继续下一轮。
- 输出 TUI/RPC 事件。

如果只用真实 CLI 测，会变成：

```bash
./pi-test.sh
# 手动输入 prompt
# 看终端输出
# 手动判断是否正确
```

实际问题：

- 依赖真实模型，慢且贵。
- 输出不稳定。
- 很难断言中间状态。
- 很难稳定复现 regression。
- compaction / stream / session 边界难测。

### 关键 commit

| Commit | 变更 | 问题指向 |
|---|---|---|
| [a5b27367](https://github.com/earendil-works/pi/commit/a5b27367) | initial harness foundation | 可控测试入口出现。 |
| [83599e78](https://github.com/earendil-works/pi/commit/83599e78) | split harness compaction and session modules | 测试基础设施按领域拆分。 |
| [e6121493](https://github.com/earendil-works/pi/commit/e6121493) | tighten harness session storage | 测试 session 存储语义收紧。 |
| [cdde2e89](https://github.com/earendil-works/pi/commit/cdde2e89) | consolidate harness session abstraction | 测试 session 抽象靠近真实 session。 |
| [d29e47c7](https://github.com/earendil-works/pi/commit/d29e47c7) | harness factory helpers | 降低测试创建成本。 |
| [e1ca501d](https://github.com/earendil-works/pi/commit/e1ca501d) | expose concrete harness | harness 作为明确 API 暴露。 |
| [530f14c0](https://github.com/earendil-works/pi/commit/530f14c0) | expose concrete harness session | 测试可直接控制 session。 |
| [617d8b31](https://github.com/earendil-works/pi/commit/617d8b31) | tighten harness environment/resources | 测试环境资源显式化。 |
| [ddb18640](https://github.com/earendil-works/pi/commit/ddb18640) | diagnostics from resource loaders | resource loader 诊断增强。 |
| [e1647aaa](https://github.com/earendil-works/pi/commit/e1647aaa) | resource invocation explicit | resource 调用显式化。 |
| [322759a3](https://github.com/earendil-works/pi/commit/322759a3) | snapshot harness turn state | 可以快照每轮状态。 |
| [e25415dd](https://github.com/earendil-works/pi/commit/e25415dd) | finalize harness resource config | resource 配置稳定。 |
| [c0f416aa](https://github.com/earendil-works/pi/commit/c0f416aa) | harness stream configuration | 流式行为可配置。 |

### 改完后的代码形态

测试不再调真实 provider：

```ts
const harness = await createHarness({
  provider: fauxProvider([
    { type: "text", text: "I will inspect the file." },
    { type: "tool_call", name: "read_file", input: { path: "src/app.ts" } },
    { type: "text", text: "The issue is..." },
  ]),
});
```

可以断言事件：

```ts
const turn = await harness.prompt("find the bug");

expect(turn.events).toContainEqual({
  type: "tool_call",
  name: "read_file",
});
```

可以断言 session 状态：

```ts
expect(turn.snapshot.messages).toMatchObject([
  { role: "user", content: "find the bug" },
  { role: "assistant" },
  { role: "tool" },
]);
```

可以测试 compaction：

```ts
await harness.seedLongHistory();
await harness.prompt("continue");

expect(harness.session.compactions).toHaveLength(1);
expect(harness.session.messages[1].content).toContain("Summary");
```

问题被解决为：

- 不依赖真实模型。
- 可以稳定复现 agent turn。
- 可以断言中间事件。
- 可以测试 session / stream / resource / compaction 边界。

## 当前三层核心链路

### 问题

你现在 debug 时最关心的是：

> 从 CLI 输入，到模型输出，中间到底经过哪些层？

### 当前代码形态可以抽象为

```ts
// 1. CLI 层：接收用户输入
const input = await interactiveInput.read();
await session.prompt(input);
```

```ts
// 2. AgentSession 层：统一 session、事件、持久化
class AgentSession {
  async prompt(input: string) {
    this.appendUserMessage(input);
    this.emit({ type: "user_message", input });

    for await (const event of runAgentLoop(this.state)) {
      this.emit(event);
      await this.persistEvent(event);
    }
  }
}
```

```ts
// 3. Agent loop 层：处理模型事件和工具调用
async function* runAgentLoop(state: AgentState) {
  const stream = await callAiProvider(state);

  for await (const event of stream) {
    if (event.type === "tool_call") {
      const result = await executeTool(event);
      state.messages.push(toToolResult(result));
      continue;
    }

    yield event;
  }
}
```

```ts
// 4. AI 层：通过 provider registry 找到具体 provider
async function callAiProvider(state: AgentState) {
  return stream({
    api: state.model.api,
    model: state.model.id,
    messages: state.messages,
    tools: state.tools,
  });
}
```

```ts
// 5. Provider 层：调用具体 SDK，并归一化为事件
async function* streamOpenAI(options: StreamOptions) {
  const response = await client.chat.completions
    .create(toOpenAIParams(options))
    .withResponse();

  for await (const chunk of response.data) {
    yield* normalizeOpenAIChunk(chunk);
  }
}
```

### 对应关系

```text
packages/coding-agent
  接收输入，选择 mode，渲染输出

packages/agent
  AgentSession，agent loop，tool orchestration，compaction，extensions

packages/ai
  provider registry，stream API，provider adapter，model metadata
```

## 最值得按顺序看的 commit

- [a74c5da1](https://github.com/earendil-works/pi/commit/a74c5da1)：monorepo 起点。
- [afa807b2](https://github.com/earendil-works/pi/commit/afa807b2)：TUI 差量渲染起点。
- [f064ea0e](https://github.com/earendil-works/pi/commit/f064ea0e)：AI 包起点。
- [004de3c9](https://github.com/earendil-works/pi/commit/004de3c9)：`AsyncIterable` streaming API。
- [ffc9be88](https://github.com/earendil-works/pi/commit/ffc9be88)：Agent package / coding-agent 起点。
- [29d96ab2](https://github.com/earendil-works/pi/commit/29d96ab2)：AgentSession 基础。
- [3559a43b](https://github.com/earendil-works/pi/commit/3559a43b)：typed RPC protocol。
- [6c2360af](https://github.com/earendil-works/pi/commit/6c2360af)：compaction 核心。
- [c6fc0845](https://github.com/earendil-works/pi/commit/c6fc0845)：unified extensions。
- [a5b27367](https://github.com/earendil-works/pi/commit/a5b27367)：harness 起点。

