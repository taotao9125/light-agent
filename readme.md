
https://github.com/user-attachments/assets/78560566-6359-4a48-9eb4-a407cd146afc

-----------------------

# Agent Runtime Architecture

```text
CLI / Server
└── new Agent(config)
    ├── canonicalEvents + ToolRegistry
    ├── contextBuilder(prompts, strategy) → { systemPrompt, events }
    └── AgentLoop.prompt()
        └── Vender.Adaptor.stream({ input, tools, systemPrompt })
            └── parseEventsIntoRoundMap → turn 内 find → vendor message 投影
```

## 模块分层

| 路径 | 职责 |
|------|------|
| `protocol/events.ts` | 事件协议：`AgentEvent`、`EventType`（protocol 层仅此文件） |
| `agent/tool.ts` | `Tool.*` 类型定义 + `ToolRegistry` 注册与执行 |
| `ai/helpers.ts` | `parseEventsIntoRoundMap`（adaptor 读 history）、`stringifyContent` |
| `agent/context/prompts.types.ts` | `Prompts.*` 类型：identity、instructions、skillIndex |
| `agent/context/runtimePrompt.constants.ts` | `RUNTIME_PROMPT_BLOCKS` 常量 |
| `agent/context/promptContextBuilder.ts` | `buildPromptContext(prompts)` |
| `agent/context/contextBuilder.ts` | `Context.*` 入口：events 裁剪 + 调 promptContextBuilder |
| `agent/agentLoop.ts` | `Loop.*`：LLM ↔ tool 循环（并行 execute） |
| `agent/agent.ts` | 会话编排、事件持久化、tool 调度 |
| `agent/helpers.ts` | `AgentViewEvent` 投影、`projectAgentView`、字符串工具 |
| `agent/store.ts` | `Session.*`：JSONL 持久化 |
| `ai/` | `Vender.*` + adaptor 工厂（`openai.ts`、`google.ts`） |
| `cli/prompts.ts` | CLI `identity` + 可选 `instructions` |

类型约定：各模块用 **namespace** 导出（`Prompts`、`Context`、`Tool`、`Vender`、`Loop`、`Session`）。

## Agent 配置

```typescript
// Vender.Config — ai/index.ts
// Context.Config — agent/context/contextBuilder.ts

interface AgentConfig {
  sessionId: string;
  store?: SessionStoreInterface;
  vender: Vender.Config;
  context: Context.Config;
}

interface AgentInterface {
  prompt(input: string): Promise<void>;
  on(listener: (event: AgentViewEvent) => void): () => void;
  registerTool(name: string, tool: Tool.Definition): void;
  interrupt(): void;
}
```

`Context.Config`：

```typescript
namespace Prompts {
  type Source = {
    identity: string;           // 必填，<identity>
    instructions?: { tag: string; content: string }[];
    skillIndex?: SkillIndexEntry[];  // 索引，非 SKILL.md 正文
  };
}

namespace Context {
  type Config = {
    prompts: Prompts.Source;
    strategy: {
      maxSingleObservationToken?: number;
      keepRecentRounds?: number;
    };
  };
}
```

System prompt 编译见下文 [Prompt 构建策略](#prompt-构建策略)。

## Prompt 构建策略

`buildPromptContext`（`agent/context/promptContextBuilder.ts`）把接入层提供的 `Prompts.Source` 编译成一条 system prompt 字符串。events 裁剪由 `contextBuilder` 的 `strategy` 单独处理，二者在 `Context.Config` 里并列：

```typescript
context: {
  prompts: Prompts.Source,   // 编译 system prompt 的原料
  strategy: Context.Strategy // events 窗口 / observation 截断
}
```

### 职责边界

| 归属 | 内容 | 谁提供 |
|------|------|--------|
| `prompts` | identity、product instructions、skill 索引 | CLI / Server 接入层 |
| `strategy` | `keepRecentRounds`、`maxSingleObservationToken` | 接入层可配 |
| runtime 块 | `contextWindowInstructions`、`parallelToolUseInstructions` | agent 自动注入（`runtimePrompt.constants.ts`），接入层不可见、不可覆盖 |
| 编译顺序 | 各段组装顺序 | agent 内置（`promptContextBuilder.ts`） |
| SKILL 正文 | `SKILL.md` 全文 | 不进 prompt；模型按索引 `read_file` 按需加载 |

tools 注册、session 持久化不在 `prompts` 里。

### 角色 vs 指导手册

- **`<identity>`**：角色——我是谁、怎么表现、输出习惯（唯一不用 `Instructions` 后缀的 tag）
- **`*Instructions`**：指导手册——怎么做、环境约束、skill 索引与用法

除 identity 外，规则类块统一 `*Instructions` 后缀；product 侧 tag 由接入层自定前缀（如 `terminalInstructions`），compile 时校验必须以 `Instructions` 结尾。

### 组装顺序

段与段之间 `\n\n` 分隔，**平铺、无外层包裹**：

```text
1. <identity>                         ← prompts.identity（必填）
2. <{product}Instructions>            ← prompts.instructions[]（0..n）
3. <contextWindowInstructions>        ← RUNTIME_PROMPT_BLOCKS[0]
4. <parallelToolUseInstructions>      ← RUNTIME_PROMPT_BLOCKS[1]
5. <skillIndexInstructions>           ← 仅 prompts.skillIndex 非空
6. <skillUsageInstructions>           ← 同上，紧跟 index 之后，不额外包裹
```

`skillIndexInstructions` 与 `skillUsageInstructions` 保持平铺相邻，不再套 `<skills>` 或 `<instructions>` 外层。

### Prompts.Source

```typescript
namespace Prompts {
  type Instruction = { tag: string; content: string };
  type SkillIndexEntry = { name: string; description: string; path: string };
  type Source = {
    identity: string;
    instructions?: Instruction[];
    skillIndex?: SkillIndexEntry[];  // 索引，非 SKILL 正文
  };
}
```

### 数据流

```text
接入层组装 Prompts.Source（cli/prompts.ts → cliPrompts）
        ↓
buildPromptContext(prompts)
  ├── wrapTag(identity)
  ├── map instructions → *Instructions blocks
  ├── merge RUNTIME_PROMPT_BLOCKS
  └── optional skillIndex + skillUsage blocks
        ↓
systemPrompt 字符串
        ↓
contextBuilder({ prompts, strategy, events })
  └── rebuildEvents(strategy) → events[]
        ↓
{ systemPrompt, events }  →  Vender.Adaptor.stream(...)
```

### CLI 最小输出示意

无 `instructions`、无 `skillIndex` 时：

```text
<identity>
你是运行在 CLI 中的编程助手…
</identity>

<contextWindowInstructions>
## 上下文窗口
…
</contextWindowInstructions>

<parallelToolUseInstructions>
…
</parallelToolUseInstructions>
```

### 文件

| 文件 | 职责 |
|------|------|
| `prompts.types.ts` | `Prompts.*` 类型 |
| `runtimePrompt.constants.ts` | `RUNTIME_PROMPT_BLOCKS` 常量 |
| `promptContextBuilder.ts` | `buildPromptContext()` 编译逻辑 |
| `contextBuilder.ts` | 入口：`prompts` + `strategy` + events → model view |

## AgentLoop

```typescript
namespace Loop {
  type Config = {
    vender: Vender.Config;
    strategy?: { maxTurns?: number };
  };
}

// prompt 时注入：
type LoopDeps = {
  abortSignal: AbortSignal;
  pullContextSnap: () => Context.BuildResult;
  pullToolsSnap: () => Tool.Definition[];
};

// 每轮 LLM 调用：
const { systemPrompt, events } = pullContextSnap();
const tools = pullToolsSnap().map(/* → Tool.Meta */);
for await (const chunk of venderAdaptor.stream({ input: events, tools, systemPrompt })) {
  // thought_delta / output_delta 流式 emit
  // stream 结束后 adaptor yield ActionsEvent（整批 tool calls）
}
// 有 actions → 并行 execute → emit ObservationsEvent
```

- adaptor 在 **stream 迭代完毕** 后 yield 单个 `ActionsEvent`，不在 delta 阶段逐条 yield action
- tool 执行用 `Promise.allSettled`；abort 在全部 settled 后检查，取消时不 emit `observations`
- `roundId` 用进程内 `randomId()` 生成，不依赖 Node `crypto`

## 职责划分

```text
Agent
  owns canonicalEvents
  owns ToolRegistry（agent/tool.ts）
  owns Context.Config（prompts + strategy）
  schedules AgentLoop

AgentLoop
  pulls context snapshot（contextBuilder）
  pulls tool snapshot
  runs Vender.Adaptor stream
  emit actions → Promise.allSettled 并行 execute → emit observations

ContextBuilder
  buildPromptContext(prompts) + events 裁剪
  keepRecentRounds：unique roundId 保序 → slice 最近 N 个 → filter（flat，不建 turn 结构）

ai/helpers.parseEventsIntoRoundMap
  adaptor 读 history：单次遍历；首个 INPUT 建 round；无 round 的 turn event 跳过

agent/helpers.projectAgentView
  canonical AgentEvent → AgentViewEvent（接入层 UI / WS 订阅面，非事实源）
```

## Event Log

`AgentEvent[]` 是唯一事实源（`protocol/events.ts`）。

```text
InputEvent
ThoughtEvent | ThoughtDeltaEvent
ActionsEvent          ← 一轮 tool 调用 batch（0..n 条 action）
ObservationsEvent     ← 对应 observations batch（与 actions 同序、同 id）
OutputEvent | OutputDeltaEvent
AgentStop
```

单轮 tool 流程：

```text
LLM stream 结束
  → adaptor yield ActionsEvent（actions[]）
  → AgentLoop emit actions（commit）
  → Promise.allSettled 并行 execute
  → AgentLoop emit observations（commit）
  → 进入下一轮 stream
```

无 `actions` 时有 `output` 则当前 round 结束。

### ActionsEvent / ObservationsEvent

```typescript
type ActionsEvent = {
  type: 'actions';
  actions: { id: string; name: string; args: Record<string, unknown> }[];
  meta?: Meta;
};

type ObservationsEvent = {
  type: 'observations';
  observations: { id: string; name: string; result: string; isError: boolean }[];
  meta?: Meta;
};
```

- `observations[i]` 与 `actions[i]` 按 **index + id** 对齐
- `result` 为 **string**（tool 返回值经 `stringify` 序列化）
- committed 事件：`input`、`thought`、`actions`、`observations`、`output`、`agent_stop`（不含 delta）

### AgentViewEvent 投影

`Agent.on()` 回调的是 **AgentViewEvent**（`agent/helpers.ts`），不是 canonical `AgentEvent`：

```typescript
type AgentViewEvent =
  | { type: 'agent_start'; meta?: Meta }           // ← input
  | { type: 'thought_delta'; text: string; meta?: Meta }
  | { type: 'output_delta'; text: string; meta?: Meta }
  | { type: 'actions'; actions: ActionsEvent['actions']; meta?: Meta }
  | { type: 'observations'; observations: ObservationsEvent['observations']; meta?: Meta }
  | { type: 'agent_stop'; cause; message; meta?: Meta };
```

字段名与 canonical 协议一致；仅 `agent_start` 等为 UI 衍生命名。CLI 对多个 action 展示 `parallel tools (N):` 进度。

## Vender Adaptor

Adaptor 把 canonical events 投影为厂商 API 格式；DeepSeek/OpenAI/Google 差异封装在 `ai/adaptors/` 内。

- 输入：`Vender.StreamInput`（events + tools + systemPrompt）
- 输出：`AsyncIterable<AgentEvent>`（流式 delta + stream 结束后的 `thought` / `actions` / `output`）
- 读 history：
  1. `parseEventsIntoRoundMap(events)` → `Map<roundId, { input, turns }>`（首个 `INPUT` 建 round，重复 `INPUT` 忽略）
  2. 每个 round 遍历 turn bucket，inline `find` 取出 `thought` / `actions` / `observations` / `output`
  3. 投影为厂商 message（OpenAI：`reasoning_content` + tool；Google：`functionResponse` batch）

## Tools

- 类型与注册：`agent/tool.ts`（`Tool.Meta`、`Tool.Definition`、`ToolRegistry`）
- 实现：`cli/tools/*`，通过 `Agent.registerTool()` 注册
- 模型返回 actions batch → registry 并行 lookup + `execute()` → observations batch

## Session 设计对比

| 项目 | Session 设计核心 |
|------|------------------|
| Pi Agent | AgentSession 是一等对象，管理 lifecycle、message history、model state、compaction、event streaming。SessionManager 负责 inMemory / create / continueRecent / open / list。支持 id / parentId 树结构，方便 fork/branch。 |
| Codex CLI | 一次连续终端对话就是一个 session，本地 JSONL，路径类似 `~/.codex/sessions/YYYY/MM/DD/rollout-xxx.jsonl`。 |
| Claude Code | session 绑定到项目目录；`--continue`、`--resume`；transcript 在 `~/.claude/projects/.../*.jsonl`。 |
| Vercel AI SDK | 更偏 UI/chat state；持久化由应用自己做。 |
| OpenClaw | Gateway + Agent runtime；session transcript 保存到 `~/.openclaw/agents/.../sessions/*.jsonl`。 |
| 本项目 | `SessionStore` 按 sessionId 写 JSONL；`AgentEvent[]` 为 canonical log。 |

## 记忆焦点测试过程

- 尝试 关键词事实问答：直接问「工具唯一事实源是什么」，答案是 `Tool.Definition`。
  无法测试出焦点注意力，因为答案太短、太显眼，模型只要做关键词检索就能答对。
- 再尝试 加入旧结论噪音：在上下文中加入「Tool.Meta 是事实源」等错误历史。
  仍然不够有效，因为噪音里带有「旧历史、不代表当前事实」等标签，模型很容易自动降权。
- 再尝试 LLM-as-judge：用第二次模型调用判断候选答案是否语义正确。
  解决了硬匹配问题，但没有解决测试本身太简单的问题。
- 再尝试 调整事实位置：把正确事实放到最前面，把噪音放在事实和最终问题之间。
  开始更接近焦点注意力测试，因为模型必须在后续长上下文之后仍然记住早期事实。
- 再尝试 去掉显眼噪音标记：删除 NOISE_BLOCK、序号、固定重复顺序。
  让噪音不再像人工合成数据，减少模型识别「这是噪音」的线索。
- 再尝试 去掉自我降权词：删除 old、draft、TODO、legacy、prototype 等前缀。
  让错误材料不再主动暴露「我是旧资料」，而是更像正式上下文。
- 再尝试 正式错误 ADR：把错误噪音写成 Architecture Decision Record 等权威文档。
  开始有效测试上下文污染，因为错误材料和正确事实具有相近权重。
- 再尝试 去掉 input/thought 里的历史线索：删除「旧设计、历史 review」等表达。
  进一步减少模型自动降权错误材料的机会。
- 再尝试 删除 noise thought：噪音结构从 input → thought → action 改为 input → action → observation。
  避免混入「过去 assistant 错误推理」的变量。
- 再尝试 opaque label：用 ZetaUnit / KappaView 替代 ToolDefinition / ToolMeta。
  验证了语义命名本身会泄漏答案。
- 再尝试 事实问答改成方案生成：让模型设计动态 registerTool 方案。
  更接近真实 agent 场景。
- 再尝试 强约束规则：早期写 Never / must 等项目约束。
  能测出规则遵守，但太像 prompt injection 测试。
- 最后尝试 中性项目术语定义：只定义 Tool.Definition 和 Tool.Meta 的含义，不用命令语气。
  测试模型在长上下文后是否还能保持早期项目内自定义概念。

结论：thought 很影响记忆焦点；约束规则很影响记忆焦点。
