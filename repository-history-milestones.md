# 仓库历史里程碑与架构演进

本文基于本地 Git 历史梳理，从第一个提交开始看这个仓库如何一步步演进到当前的 CLI Agent / AI provider / TUI / extension 系统。仓库当前约 4086 个提交，本文不是完整 changelog，而是按“问题驱动”筛选关键架构节点。

每个关键节点都标注 commit id，便于用以下命令追溯：

```bash
git show <commit-id>
```

## 一句话总览

这个仓库的演进主线不是“不断加功能”，而是持续把真实使用中冒出来的复杂性向下沉淀成架构边界：

```text
单包/脚手架
  -> monorepo 多包协作
  -> TUI 渲染系统 + AI provider 抽象
  -> Web / browser 实验带来 session、storage、runtime bridge
  -> agent 核心从 UI 和 CLI 中抽出
  -> AgentSession 统一 CLI / RPC / interactive
  -> compaction 解决长会话
  -> hooks / skills / custom tools 合并为 extension runtime
  -> harness 让复杂 agent 行为可测试
```

## 阶段 1：先定 monorepo，因为后面一定会多包协作

时间：2025-08-09 起

### 当时的问题

如果这个项目只是一个 CLI 小工具，单包就够了。但从最早提交看，作者很早就预期会有多个相互依赖但职责不同的部分：

- AI provider 抽象。
- TUI 渲染。
- Agent 核心逻辑。
- CLI / coding-agent 产品入口。
- 未来可能还有 web-ui、browser、docs、examples。

如果一开始放在单包里，后面会遇到几个真实问题：

- `ai` 层改 provider 类型，会影响 CLI、TUI、Web UI，一堆内部路径互相引用。
- TUI 渲染和 AI 调用生命周期不同，却会被迫一起发布和测试。
- CLI 想作为产品发布，但内部库也需要给别的包复用。
- TypeScript 构建输出、exports、package boundary 后补会很痛。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [a74c5da1](https://github.com/earendil-works/pi/commit/a74c5da1) | 初始 monorepo，npm workspaces，双 TypeScript 配置 | 从第一天建立多包边界，避免后面拆包成本过高。 |
| [f579a3f1](https://github.com/earendil-works/pi/commit/f579a3f1) | lockstep versioning | 多包强耦合阶段，用统一版本降低兼容性判断成本。 |
| [42bf7b4a](https://github.com/earendil-works/pi/commit/42bf7b4a) | husky pre-commit formatting/type checking | 在多包仓库里用工具保证一致质量，减少跨包类型错误。 |

### 架构变化

早期设计已经不是：

```text
src/
  cli.ts
  ai.ts
  tui.ts
```

而是朝这个方向走：

```text
packages/
  ai/
  tui/
  agent/
  coding-agent/
  web-ui/
```

### 设计思想

这里的设计选择是“先承认复杂度会存在”。monorepo 不是为了形式，而是为了让不同层可以独立形成 API：

- `packages/ai` 对外提供模型调用能力。
- `packages/agent` 对外提供 agent loop 和工具编排。
- `packages/coding-agent` 对外提供 CLI 产品入口。
- `packages/tui` 对外提供终端渲染能力。

后续所有架构演进基本都建立在这个多包边界上。

## 阶段 2：TUI 先变复杂，因为 Agent 不是普通 stdout 程序

时间：2025-08-10 到 2025-11-11

### 当时的问题

一个普通 CLI 可以用 `console.log()` 输出结果。但 Agent CLI 不一样：

- 模型输出是流式的。
- tool call 会插入中间状态。
- 用户输入框要一直保留。
- 状态栏、快捷键、选择器会频繁变化。
- 终端 scrollback 不能被破坏，否则用户无法回看历史。

如果直接整屏重绘，会出现：

- 闪烁。
- 输入光标跳动。
- 历史输出被刷掉。
- 长输出和输入框互相覆盖。
- 复杂交互下很难维护。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [afa807b2](https://github.com/earendil-works/pi/commit/afa807b2) | `tui-double-buffer`，smart differential rendering，terminal abstraction | 不再每次整屏输出，而是维护屏幕 buffer 并做差量渲染。 |
| [0131b29b](https://github.com/earendil-works/pi/commit/0131b29b) | preserve scrollback | 避免 TUI 渲染污染用户终端历史。 |
| [386f90fc](https://github.com/earendil-works/pi/commit/386f90fc) | surgical differential rendering | 精细更新局部区域，降低闪烁和渲染副作用。 |
| [97c730c8](https://github.com/earendil-works/pi/commit/97c730c8) | minimal TUI rewrite with differential rendering | 早期实现复杂后重写，保留核心渲染思想。 |
| [741add44](https://github.com/earendil-works/pi/commit/741add44) | refactor TUI into proper components | 从“渲染工具”升级成“组件系统”。 |

### 架构变化

早期简单输出模型：

```text
agent event -> console.log()
```

演进后模型：

```text
agent event
  -> TUI state
  -> component tree
  -> screen buffer
  -> diff previous/next
  -> terminal patches
```

伪代码：

```ts
const previous = screenBuffer.snapshot();
const next = render(componentTree, currentState);

for (const patch of diff(previous, next)) {
  terminal.apply(patch);
}

screenBuffer.replace(next);
```

### 设计思想

TUI 的核心不是“好看”，而是“稳定承载流式交互”。Agent 的输出不是最终文本，而是一段运行过程。双缓冲和差量渲染的价值，是把“终端屏幕”当成一个有状态 UI，而不是一次性日志。

这解释了为什么 TUI 相关提交很早出现：终端体验如果不稳，后面的 agent loop、tool call、streaming 再强，也很难被用户实际使用。

## 阶段 3：AI 包从 SDK wrapper 变成 provider 协议层

时间：2025-08-17 到 2025-09-11

### 当时的问题

最容易想到的实现是：

```ts
const client = new OpenAI();
const stream = await client.chat.completions.create(...);
```

但真实仓库很快接入了多个 provider：

- OpenAI。
- Anthropic。
- Gemini。
- 后来还有 DeepSeek、Vertex、GitHub Copilot、OpenAI Codex OAuth、Mistral、Moonshot、Together、Cloudflare AI Gateway 等。

这些 provider 的差异不是“参数名不同”这么简单：

- 消息格式不同。
- system prompt 位置不同。
- tool schema 格式不同。
- tool call 可能流式分片。
- thinking / reasoning block 表达不同。
- usage / cost 字段不同。
- stop reason 不同。
- 有的用 API key，有的用 OAuth，有的用云平台 ADC。
- 有的 provider 在浏览器环境不能被静态 import。

如果 agent loop 直接写 provider 分支，会变成：

```ts
if (provider === "openai") {
  // openai stream parsing
} else if (provider === "anthropic") {
  // anthropic stream parsing
} else if (provider === "gemini") {
  // gemini stream parsing
}
```

这样新增 provider 会污染 agent 主流程，长期不可维护。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [f064ea0e](https://github.com/earendil-works/pi/commit/f064ea0e) | 创建统一 AI package，支持 OpenAI / Anthropic / Gemini | 把 provider 调用从应用层剥离出来。 |
| [e5aedfed](https://github.com/earendil-works/pi/commit/e5aedfed) | Anthropic Messages API provider | 多 provider 分支开始落到 AI 层。 |
| [8364ecde](https://github.com/earendil-works/pi/commit/8364ecde) | OpenAI Completions and Responses providers | 同一厂商不同 API 也用 provider 能力隔离。 |
| [a8ba19f0](https://github.com/earendil-works/pi/commit/a8ba19f0) | Gemini provider with streaming/tools | provider 层开始处理 tool calling 和 streaming 差异。 |
| [02a9b4f0](https://github.com/earendil-works/pi/commit/02a9b4f0) | models.dev integration | 模型列表从手写常量转向数据源同步。 |
| [da66a97e](https://github.com/earendil-works/pi/commit/da66a97e) | autogenerated TypeScript models and factory | 模型元数据生成化，减少人工维护。 |
| [c7618db3](https://github.com/earendil-works/pi/commit/c7618db3) | type-safe `createLLM` | 模型选择和 provider 能力收敛到类型安全入口。 |
| [550da5e4](https://github.com/earendil-works/pi/commit/550da5e4) | cost tracking | AI 层开始暴露 usage / cost，而不只是文本。 |
| [f29752ac](https://github.com/earendil-works/pi/commit/f29752ac) | multiple thinking and text blocks | 内容模型从单文本升级为多 block。 |
| [a132b814](https://github.com/earendil-works/pi/commit/a132b814) | provider start event | streaming 协议开始有生命周期事件。 |
| [004de3c9](https://github.com/earendil-works/pi/commit/004de3c9) | new streaming generate API with `AsyncIterable` | 用语言原生异步迭代表达流式输出。 |
| [66cefb23](https://github.com/earendil-works/pi/commit/66cefb23) | massive API refactor | 多 provider 压力下重新整理 API。 |
| [4cee070b](https://github.com/earendil-works/pi/commit/4cee070b) | simplified streaming interface / model management | 上层消费统一事件，不直接消费 SDK chunk。 |
| [35fe8f21](https://github.com/earendil-works/pi/commit/35fe8f21) | tool validation with Zod | tool call 参数开始结构化校验。 |
| [e8370436](https://github.com/earendil-works/pi/commit/e8370436) | replace Zod with TypeBox | 更贴近 JSON Schema，便于 provider tool schema 转换。 |
| [39c626b6](https://github.com/earendil-works/pi/commit/39c626b6) | partial JSON parsing for streaming tool calls | 处理模型分片输出 tool 参数的真实问题。 |
| [2296dc40](https://github.com/earendil-works/pi/commit/2296dc40) | typed errors and stop reasons | 错误和停止原因成为协议的一部分。 |

### 架构变化

之前：

```text
agent loop
  -> OpenAI SDK
  -> parse OpenAI stream
```

之后：

```text
agent loop
  -> ai.stream(options)
  -> provider registry
  -> provider implementation
  -> vendor SDK
  -> normalize chunk
  -> AssistantMessageEventStream
```

伪代码：

```ts
async function* streamProvider(options: StreamOptions) {
  const vendorStream = await vendorClient.create(toVendorParams(options));

  for await (const chunk of vendorStream) {
    const event = normalizeVendorChunk(chunk);
    if (event) yield event;
  }

  yield { type: "stop", reason: "end_turn" };
}
```

### 设计思想

AI 包的职责不是“帮你调 SDK”，而是“把不同厂商的运行协议统一成 agent 能消费的事件协议”。

这也是后来 `streamSimple`、provider registry、lazy import 能成立的基础：上层不关心底层是 OpenAI SDK、Anthropic SDK、OAuth provider、ADC provider，最后都必须变成统一事件流。

## 阶段 4：Web / browser 实验暴露出 runtime 和 storage 问题

时间：2025-10-01 到 2025-10-13

### 当时的问题

CLI 里很多东西默认成立：

- 可以读写本地文件。
- 可以使用 Node API。
- 可以直接保存 session。
- 可以调用子进程。
- 可以把输出写到终端。

到了 browser extension / web-ui，这些都不成立：

- 浏览器不能直接使用 `node:fs`、`node:child_process`。
- provider SDK 可能带 Node-only 依赖。
- CORS、storage、runtime bridge 都要单独处理。
- UI 不只是文本，需要 typed renderer。
- artifact / REPL 执行环境必须和 UI 隔离。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [b67c10df](https://github.com/earendil-works/pi/commit/b67c10df) | cross-browser extension with AI reading assistant | Agent 能力第一次进入浏览器场景。 |
| [f2eecb78](https://github.com/earendil-works/pi/commit/f2eecb78) | add web-ui package | 从扩展走向独立 Web UI。 |
| [04966513](https://github.com/earendil-works/pi/commit/04966513) | prompt caching, pluggable storage, CORS proxy | Web 场景下处理缓存、存储、跨域。 |
| [e5cf25a2](https://github.com/earendil-works/pi/commit/e5cf25a2) | refactor agent architecture and add session storage | session/storage 开始成为架构概念。 |
| [05dfaa11](https://github.com/earendil-works/pi/commit/05dfaa11) | custom message extension system | 前端输出从纯文本变成 typed message rendering。 |
| [aa005d06](https://github.com/earendil-works/pi/commit/aa005d06) | remove browser-extension package | 浏览器扩展迁出，仓库收缩边界。 |
| [bbbc232c](https://github.com/earendil-works/pi/commit/bbbc232c) | unified storage architecture | 多 runtime 下统一 storage 接口。 |
| [0de89a75](https://github.com/earendil-works/pi/commit/0de89a75) | store-based architecture | 前端状态集中管理。 |
| [c2793d80](https://github.com/earendil-works/pi/commit/c2793d80) | runtime bridge for artifacts and REPL | UI 和执行环境通过 bridge 隔离。 |

### 架构变化

CLI 假设：

```text
agent -> local filesystem / child_process / terminal
```

Web 场景需要：

```text
web-ui
  -> store
  -> runtime bridge
  -> storage adapter
  -> artifact / REPL runtime
  -> agent / ai boundary
```

### 设计思想

这一阶段的价值不是 web-ui 本身，而是它逼出了“运行环境不是固定 Node CLI”的问题。

后面你看到的 provider lazy import、browser-safe export、storage abstraction、runtime bridge，本质上都和这个问题有关：同一套 agent/AI 能力需要在不同 runtime 下尽可能复用，但 Node-only 能力必须隔离。

## 阶段 5：Agent 从 UI / CLI 代码中独立出来

时间：2025-10-17 到 2025-11-17

### 当时的问题

随着 CLI、TUI、web-ui 都在使用 AI 能力，问题变成：

> 到底谁负责“agent 是怎么跑的”？

如果 agent loop 写在 CLI 里：

- web-ui 复用困难。
- RPC 模式要重写。
- session resume 要复制逻辑。
- tool orchestration 和 UI 事件耦合。
- 测试只能通过 CLI 黑盒测。

所以必须把 agent 核心从产品入口中抽出来。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [ffc9be88](https://github.com/earendil-works/pi/commit/ffc9be88) | Agent package + coding agent WIP | agent 核心开始成为独立包。 |
| [92bad861](https://github.com/earendil-works/pi/commit/92bad861) | remove `agent-old` | 旧 agent 路线被清理，新架构成为主线。 |
| [95d04019](https://github.com/earendil-works/pi/commit/95d04019) | model selector TUI and session management | CLI 开始管理模型和 session，不只是调用一次模型。 |
| [458702b3](https://github.com/earendil-works/pi/commit/458702b3) | `--resume` and session selector | session 进入用户工作流。 |
| [812f2f43](https://github.com/earendil-works/pi/commit/812f2f43) | defer session creation | session 生命周期更精确，避免空会话污染。 |
| [dca3e1cc](https://github.com/earendil-works/pi/commit/dca3e1cc) | hierarchical context file loading | monorepo 下按目录加载上下文。 |
| [b1c2c32e](https://github.com/earendil-works/pi/commit/b1c2c32e) | move context files to system prompt | 项目规则从普通消息提升到系统上下文。 |

### 架构变化

之前：

```text
CLI command
  -> parse args
  -> build prompt
  -> call model
  -> print output
```

之后：

```text
CLI / TUI / RPC
  -> coding-agent orchestration
  -> agent core
  -> tools
  -> ai package
  -> provider
```

### 设计思想

Agent core 的边界出现，是因为“agent loop”本身已经变成一个领域模型。它不只是调用模型，而是持续处理：

- 用户输入。
- 系统上下文。
- 模型事件。
- tool call。
- tool result。
- 中断。
- session 保存。
- UI / RPC 事件转发。

这个复杂度不能长期放在 CLI 文件里。

## 阶段 6：Session-first 架构出现，统一 CLI / RPC / interactive

时间：2025-11-13 到 2025-12-11

### 当时的问题

当系统有多种入口时，最危险的问题是“每个入口都实现一遍 agent 运行逻辑”：

- interactive TUI 一套逻辑。
- `--mode text` 一套逻辑。
- `--mode json` 一套逻辑。
- RPC 一套逻辑。
- resume / export / branch 又各自处理 session。

这样会导致：

- 同一个 prompt 在不同 mode 下行为不一致。
- 修复 tool 调用 bug 要改多个入口。
- session 保存时机不一致。
- compaction、queue、model switching 很难横向复用。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [68092ccf](https://github.com/earendil-works/pi/commit/68092ccf) | `--mode text/json/rpc` | CLI 开始同时面向人和机器。 |
| [9e3e319f](https://github.com/earendil-works/pi/commit/9e3e319f) | session export HTML and RPC docs | session 成为可导出、可集成对象。 |
| [1507f8b7](https://github.com/earendil-works/pi/commit/1507f8b7) | coding-agent refactoring plan | 大重构前先定义迁移方案。 |
| [29d96ab2](https://github.com/earendil-works/pi/commit/29d96ab2) | WP2 AgentSession basic structure | `AgentSession` 成为统一 facade。 |
| [eba196f4](https://github.com/earendil-works/pi/commit/eba196f4) | WP3 event subscription and persistence | session 可订阅、可持久化。 |
| [d08e1e53](https://github.com/earendil-works/pi/commit/d08e1e53) | WP4 prompting methods | prompt 通过 session API 进入。 |
| [0119d761](https://github.com/earendil-works/pi/commit/0119d761) | WP5/WP6 model, thinking, queue mode | session 层管理模型、thinking、队列。 |
| [8d6d2dd7](https://github.com/earendil-works/pi/commit/8d6d2dd7) | WP7 compaction | compaction 进入 session 能力。 |
| [94ff0b09](https://github.com/earendil-works/pi/commit/94ff0b09) | WP8 bash execution | 工具执行进入 session orchestration。 |
| [934c2bc5](https://github.com/earendil-works/pi/commit/934c2bc5) | WP9/WP10 session management | session 生命周期进一步标准化。 |
| [e7c71e7e](https://github.com/earendil-works/pi/commit/e7c71e7e) | WP12 RPC mode using AgentSession | RPC 不再自建主循环。 |
| [e9f6de7c](https://github.com/earendil-works/pi/commit/e9f6de7c) | WP14 new CLI using AgentSession | CLI 切到新 session 架构。 |
| [0020de85](https://github.com/earendil-works/pi/commit/0020de85) | WP15 InteractiveMode using AgentSession | interactive mode 和 RPC 共用核心。 |
| [1a6a1a8a](https://github.com/earendil-works/pi/commit/1a6a1a8a) | split main-new into CLI/core modules | CLI 参数层和核心执行层拆开。 |
| [dcf81a6a](https://github.com/earendil-works/pi/commit/dcf81a6a) | Release v0.15.0 | AgentSession 重构阶段发布。 |
| [3559a43b](https://github.com/earendil-works/pi/commit/3559a43b) | typed RPC protocol and client | RPC 协议类型化。 |
| [796112f4](https://github.com/earendil-works/pi/commit/796112f4) | Release v0.16.0 | RPC breaking change 成为版本边界。 |

### 架构变化

之前：

```text
interactive mode -> agent loop
text mode        -> agent loop
json mode        -> agent loop
rpc mode         -> agent loop
```

之后：

```text
interactive mode
text mode
json mode
rpc mode
      |
      v
AgentSession
      |
      v
Agent / tools / ai
```

伪代码：

```ts
const session = await openAgentSession(options);

session.on("event", event => {
  outputAdapter.write(event);
});

await session.prompt(userInput);
```

### 设计思想

`AgentSession` 的意义是把“长期 agent 任务”变成一个稳定边界。它不是简单的历史记录对象，而是：

- 状态容器。
- 事件源。
- prompt 入口。
- persistence 协调者。
- tool execution 协调者。
- compaction 承载点。
- CLI / RPC / TUI 的共同核心。

这也是这个仓库最重要的架构转折之一。

## 阶段 7：Compaction 是长会话产品化后必然出现的问题

时间：2025-12-12 到 2025-12-13

### 当时的问题

短对话可以简单把所有消息传给模型。但 coding agent 的真实工作流会非常长：

- 读很多文件。
- 运行命令。
- 修改代码。
- 解释错误。
- 再读文件。
- 再修复。
- 用户中途追问。

如果完整保留历史：

- token 成本越来越高。
- prompt 越来越慢。
- 达到 context limit 后直接失败。

如果简单截断历史：

- agent 忘记用户目标。
- 忘记已修改文件。
- 忘记失败过的方案。
- tool result 和后续推理断裂。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [5daef11b](https://github.com/earendil-works/pi/commit/5daef11b) | compaction research and plan | 先把长上下文问题作为架构问题分析。 |
| [50b334f8](https://github.com/earendil-works/pi/commit/50b334f8) | compaction examples and branch interaction | compaction 和 branch/session 工作流关联。 |
| [1c18b800](https://github.com/earendil-works/pi/commit/1c18b800) | auto-compaction trigger flow | 不完全依赖用户手动触发。 |
| [6c2360af](https://github.com/earendil-works/pi/commit/6c2360af) | context compaction core logic | 实现压缩核心。 |
| [79731249](https://github.com/earendil-works/pi/commit/79731249) | commands, auto-trigger, RPC support | compaction 覆盖 CLI 和 RPC。 |
| [c89b1ec3](https://github.com/earendil-works/pi/commit/c89b1ec3) | `/compact`, `/autocompact`, auto trigger | 用户可控和系统自动结合。 |
| [a38e6190](https://github.com/earendil-works/pi/commit/a38e6190) | overflow recovery | 处理已经溢出的恢复路径。 |
| [5a9d844f](https://github.com/earendil-works/pi/commit/5a9d844f) | simplify compaction with `Agent.continue` retry | 把复杂恢复收敛进 continuation 语义。 |

### 架构变化

未压缩：

```text
system prompt
  + all previous messages
  + all tool results
  + new user prompt
  -> model
```

压缩后：

```text
system prompt
  + compacted summary of old work
  + recent high-fidelity messages
  + new user prompt
  -> model
```

伪代码：

```ts
if (contextSize(history) > threshold) {
  const summary = await compact(history.oldMessages);

  history = [
    systemPrompt,
    summaryMessage(summary),
    ...history.recentMessages,
  ];
}
```

### 设计思想

Compaction 的设计不是为了省 token 这么简单，而是为了让 agent 可以作为“长期任务执行器”存在。

真实问题是：用户期望 agent 记得任务目标，但模型上下文窗口有限。compaction 是把“完整历史”变成“任务状态摘要 + 最近细节”的机制。

## 阶段 8：Provider 注册和 lazy import 是 provider 数量增长后的维护策略

时间：2025-11-23 起，2026-01 后持续扩展

### 当时的问题

provider 越来越多后，如果全部静态 import，会出现实际工程问题：

- 启动时加载所有 provider，CLI 冷启动变慢。
- 浏览器 / Vite 会扫描到 Node-only 依赖。
- 某个 provider 的可选依赖或认证 SDK 出问题，会影响不用它的用户。
- 内置 provider 和用户自定义 provider 的优先级不好处理。
- provider 认证方式差异越来越大：API key、OAuth、ADC、Copilot token 等。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [0c5cbd00](https://github.com/earendil-works/pi/commit/0c5cbd00) | custom models/providers via `models.json` | 用户可以添加自定义 provider。 |
| [587d7c39](https://github.com/earendil-works/pi/commit/587d7c39) | Anthropic OAuth | provider auth 不再只是 API key。 |
| [243104fa](https://github.com/earendil-works/pi/commit/243104fa) | custom providers override built-ins | 用户配置可以覆盖内置 provider。 |
| [214e7dae](https://github.com/earendil-works/pi/commit/214e7dae) | Vertex AI with ADC | 云平台认证进入 provider 层。 |
| [b66157c6](https://github.com/earendil-works/pi/commit/b66157c6) | GitHub Copilot support | 支持非传统模型 API 来源。 |
| [1650041a](https://github.com/earendil-works/pi/commit/1650041a) | OpenAI Codex OAuth and Responses provider | OAuth + Responses API 进入 provider 体系。 |
| [edb0da96](https://github.com/earendil-works/pi/commit/edb0da96) | provider `sessionId` for caching | provider 可以利用会话级缓存。 |

### 架构变化

不注册时：

```text
ai/index.ts
  import openai
  import anthropic
  import gemini
  import vertex
  import copilot
  ...
```

注册后：

```text
provider registry
  "openai"    -> loader
  "deepseek"  -> loader
  "vertex"    -> loader
  "copilot"   -> loader
```

伪代码：

```ts
registerApiProvider("deepseek", {
  stream: async options => {
    const provider = await loadDeepSeekProvider();
    return provider.streamDeepSeek(options);
  },
});
```

### 设计思想

provider registry 的核心不是“为了优雅”，而是为了避免 provider 复杂度传染到全系统。

lazy import 的价值是：

- 用哪个 provider 才加载哪个 provider。
- Node-only provider 不影响 browser-safe 入口。
- 可选 provider 失败不会拖垮主程序。
- 用户 provider 可以覆盖内置 provider。

这也是你之前看到 Vite dynamic import warning、Node builtin externalized 报错的背景：仓库的主运行时是 Node CLI，Web UI 复用这些包时必须特别隔离 Node-only provider 和工具实现。

## 阶段 9：Hooks、skills、custom tools 从分散机制合并成 extension runtime

时间：2025-12-19 到 2026-01-07

### 当时的问题

随着用户想扩展 agent，会自然出现多种需求：

- 在某个生命周期点执行逻辑：hooks。
- 给 agent 注入工作流知识：skills。
- 增加模型可调用工具：custom tools。
- 扩展快捷键、CLI flag、tool 权限。
- 扩展之间互相通信。

一开始这些能力可以分别实现。但问题很快出现：

- 每套机制都要处理 discovery。
- 每套机制都要拿 session/context。
- 每套机制都要处理权限。
- 每套机制都要处理加载顺序。
- 每套机制都可能影响 tool availability。

长期保留多套机制，会形成扩展系统内部的重复架构。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [04d59f31](https://github.com/earendil-works/pi/commit/04d59f31) | hooks system | 生命周期扩展点出现。 |
| [7c553acd](https://github.com/earendil-works/pi/commit/7c553acd) | hooks with `pi.send` | hook 可以主动向运行时发事件。 |
| [09bca967](https://github.com/earendil-works/pi/commit/09bca967) | Claude Code-compatible skills | skill 作为可发现工作流能力出现。 |
| [3b2b9abf](https://github.com/earendil-works/pi/commit/3b2b9abf) | `SKILL.md` convention | skill 文件约定标准化。 |
| [e707ac4c](https://github.com/earendil-works/pi/commit/e707ac4c) | skills API export and auto-discovery | skills 变成可复用 API。 |
| [e7097d91](https://github.com/earendil-works/pi/commit/e7097d91) | custom tools with session lifecycle | 用户工具和 session 生命周期绑定。 |
| [9c9e6822](https://github.com/earendil-works/pi/commit/9c9e6822) | event bus | tool/hook 通信解耦。 |
| [059292ea](https://github.com/earendil-works/pi/commit/059292ea) | hook API dynamic tool control / plan-mode WIP | hook 开始影响工具控制和模式。 |
| [c956a726](https://github.com/earendil-works/pi/commit/c956a726) | hook API for CLI flags, shortcuts, tool control | hooks 从生命周期扩展到产品行为。 |
| [2846c7d1](https://github.com/earendil-works/pi/commit/2846c7d1) | unified extensions system, not wired | 开始统一 extension 抽象。 |
| [9794868b](https://github.com/earendil-works/pi/commit/9794868b) | extension discovery with package manifest | 扩展用 manifest 发现。 |
| [c6fc0845](https://github.com/earendil-works/pi/commit/c6fc0845) | merge hooks and custom-tools into unified extensions | hooks/custom tools 合并到统一运行时。 |
| [78d0b88f](https://github.com/earendil-works/pi/commit/78d0b88f) | Release v0.35.0 | extension 体系阶段性发布。 |
| [cb3ac0ba](https://github.com/earendil-works/pi/commit/cb3ac0ba) | simplify extension runtime architecture | 合并后继续降低 runtime 复杂度。 |
| [b1fb9106](https://github.com/earendil-works/pi/commit/b1fb9106) | unify tool/event handler context creation | 统一 handler context，减少入口差异。 |

### 架构变化

分散机制：

```text
hooks loader
skills loader
custom tools loader
shortcut loader
```

统一后：

```text
extension discovery
  -> manifest
  -> extension runtime
  -> hooks
  -> tools
  -> skills
  -> event handlers
```

### 设计思想

extension runtime 是维护性驱动的结果。它解决的不是某个单点功能，而是“外部能力如何安全、一致、可发现地进入 agent 系统”。

这类设计通常不会在项目早期一次性设计好，而是等 hooks、skills、custom tools 各自暴露出重复问题后，再抽象统一。

## 阶段 10：Harness 出现，说明 agent 行为已经不能只靠手测

时间：2026-05-03 起

### 当时的问题

普通库函数可以单元测试。但 agent 行为复杂得多：

- 模型流是异步的。
- tool call 会改变文件系统或执行命令。
- session 会持久化。
- compaction 会改变历史。
- resources 会被加载和格式化。
- 每一轮 turn 都有中间状态。
- 真实 provider 昂贵、慢、不稳定，也不适合 CI。

如果只靠手动启动 CLI 测试：

- 不可重复。
- 很难断言中间状态。
- 不能稳定覆盖回归。
- 不适合测试 compaction / streaming / session 边界。

### 对应里程碑

| Commit | 变化 | 解决的问题 |
|---|---|---|
| [a5b27367](https://github.com/earendil-works/pi/commit/a5b27367) | initial harness foundation | 建立可控测试入口。 |
| [83599e78](https://github.com/earendil-works/pi/commit/83599e78) | split harness compaction and session modules | harness 也按领域拆分。 |
| [e6121493](https://github.com/earendil-works/pi/commit/e6121493) | tighten harness session storage | 收紧测试 session 存储语义。 |
| [cdde2e89](https://github.com/earendil-works/pi/commit/cdde2e89) | consolidate harness session abstraction | 测试 session 抽象和真实 session 靠拢。 |
| [3d0f5718](https://github.com/earendil-works/pi/commit/3d0f5718) | simplify harness session repo layout | 简化测试仓库布局。 |
| [d29e47c7](https://github.com/earendil-works/pi/commit/d29e47c7) | harness factory helpers | 测试创建成本降低。 |
| [e1ca501d](https://github.com/earendil-works/pi/commit/e1ca501d) | expose concrete harness | harness 作为明确测试 API 暴露。 |
| [530f14c0](https://github.com/earendil-works/pi/commit/530f14c0) | expose concrete harness session | 测试可以直接控制 session。 |
| [617d8b31](https://github.com/earendil-works/pi/commit/617d8b31) | tighten harness environment/resources | 显式管理测试环境资源。 |
| [ddb18640](https://github.com/earendil-works/pi/commit/ddb18640) | diagnostics from resource loaders | resource loader 诊断增强。 |
| [e1647aaa](https://github.com/earendil-works/pi/commit/e1647aaa) | resource invocation explicit | resource 调用显式化。 |
| [322759a3](https://github.com/earendil-works/pi/commit/322759a3) | snapshot harness turn state | 可以断言每一轮 agent 状态。 |
| [e25415dd](https://github.com/earendil-works/pi/commit/e25415dd) | finalize harness resource config | resource 配置稳定化。 |
| [c0f416aa](https://github.com/earendil-works/pi/commit/c0f416aa) | harness stream configuration | 测试可控 stream 行为。 |

### 架构变化

不可控测试：

```text
run real CLI
  -> real model
  -> real filesystem
  -> inspect output manually
```

可控 harness：

```text
harness
  -> faux provider stream
  -> controlled session storage
  -> controlled resources
  -> snapshot turn state
  -> assert events/results
```

### 设计思想

Harness 的出现说明项目开始把“agent 是状态机”这件事测试化。它不是为了测试某个函数，而是为了测试一段完整 agent turn 的输入、事件、中间状态和输出。

## 横向设计主线

### 主线 1：从同步返回值到事件流

早期直觉：

```ts
const result = await askModel(prompt);
```

最终演进：

```ts
for await (const event of session.prompt(prompt)) {
  render(event);
}
```

原因：

- 模型是流式输出。
- tool call 是中间事件。
- thinking / usage / stop reason 都不是最终文本。
- UI / RPC / JSON mode 需要消费同一组事件。

相关 commits：

- [004de3c9](https://github.com/earendil-works/pi/commit/004de3c9)
- [a132b814](https://github.com/earendil-works/pi/commit/a132b814)
- [2296dc40](https://github.com/earendil-works/pi/commit/2296dc40)
- [eba196f4](https://github.com/earendil-works/pi/commit/eba196f4)
- [3559a43b](https://github.com/earendil-works/pi/commit/3559a43b)

### 主线 2：从 provider 分支到 provider registry

早期直觉：

```ts
switch (provider) {
  case "openai": ...
  case "anthropic": ...
}
```

最终演进：

```ts
const provider = registry.get(api);
return provider.stream(options);
```

原因：

- provider 数量持续增长。
- 认证方式差异变大。
- 浏览器和 Node runtime 需要隔离。
- 用户自定义 provider 需要覆盖内置 provider。

相关 commits：

- [f064ea0e](https://github.com/earendil-works/pi/commit/f064ea0e)
- [8364ecde](https://github.com/earendil-works/pi/commit/8364ecde)
- [a8ba19f0](https://github.com/earendil-works/pi/commit/a8ba19f0)
- [0c5cbd00](https://github.com/earendil-works/pi/commit/0c5cbd00)
- [243104fa](https://github.com/earendil-works/pi/commit/243104fa)
- [214e7dae](https://github.com/earendil-works/pi/commit/214e7dae)
- [1650041a](https://github.com/earendil-works/pi/commit/1650041a)

### 主线 3：从 CLI 主流程到 AgentSession facade

早期直觉：

```text
parse args -> run agent -> print
```

最终演进：

```text
CLI / RPC / TUI
  -> AgentSession
  -> Agent
  -> AI
```

原因：

- 多入口需要共享行为。
- session resume/export/branch 是核心用户工作流。
- compaction、queue、model switching 需要统一状态。
- RPC 需要稳定协议而不是复用 stdout。

相关 commits：

- [68092ccf](https://github.com/earendil-works/pi/commit/68092ccf)
- [29d96ab2](https://github.com/earendil-works/pi/commit/29d96ab2)
- [eba196f4](https://github.com/earendil-works/pi/commit/eba196f4)
- [e7c71e7e](https://github.com/earendil-works/pi/commit/e7c71e7e)
- [e9f6de7c](https://github.com/earendil-works/pi/commit/e9f6de7c)
- [0020de85](https://github.com/earendil-works/pi/commit/0020de85)

### 主线 4：从点状扩展到 extension runtime

早期直觉：

```text
hooks
skills
custom tools
```

最终演进：

```text
extension runtime
  -> hooks
  -> skills
  -> tools
  -> event handlers
```

原因：

- 所有扩展都需要 discovery。
- 所有扩展都需要 session/context。
- 所有扩展都可能影响 tool availability。
- 多套扩展机制会重复权限和生命周期逻辑。

相关 commits：

- [04d59f31](https://github.com/earendil-works/pi/commit/04d59f31)
- [09bca967](https://github.com/earendil-works/pi/commit/09bca967)
- [e7097d91](https://github.com/earendil-works/pi/commit/e7097d91)
- [9c9e6822](https://github.com/earendil-works/pi/commit/9c9e6822)
- [2846c7d1](https://github.com/earendil-works/pi/commit/2846c7d1)
- [c6fc0845](https://github.com/earendil-works/pi/commit/c6fc0845)
- [cb3ac0ba](https://github.com/earendil-works/pi/commit/cb3ac0ba)

## 当前架构可以这样理解

```text
用户输入
  |
  v
packages/coding-agent
  - CLI 参数
  - interactive mode
  - RPC/text/json mode
  - TUI 输出适配
  |
  v
AgentSession
  - prompt 入口
  - session persistence
  - event subscription
  - queue/model/thinking state
  - compaction
  |
  v
packages/agent
  - agent loop
  - tool orchestration
  - context handling
  - extension hooks/tools
  |
  v
packages/ai
  - provider registry
  - stream API
  - model metadata
  - provider adapters
  |
  v
provider SDK / HTTP API
```

## 最值得优先看的 commit

如果只想看架构演进，不建议从 4086 个提交逐个看。建议按下面顺序看：

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

## 结论

这个仓库的设计不是一次性规划出来的。更准确的说法是：

- 多 provider 逼出了 `packages/ai` 的统一事件协议。
- 流式交互逼出了 TUI 差量渲染。
- 多入口逼出了 `AgentSession`。
- 长任务逼出了 compaction。
- 用户扩展需求逼出了 extension runtime。
- 复杂状态机逼出了 harness。

因此看这个仓库时，不应只看“有哪些包”，而要看每个包是在解决哪个现实压力：

- `ai` 解决 provider 差异。
- `agent` 解决 agent loop 和工具编排。
- `coding-agent` 解决产品入口和会话工作流。
- `tui` 解决终端流式 UI。
- extension system 解决外部能力接入。
- harness 解决复杂 agent 行为可测试。
