# Agent Runtime Architecture

```text
CLI / Server
└── new Agent(config)
    ├── canonicalEvents + ToolRegistry
    ├── contextBuilder(source, strategy) → { systemPrompt, events }
    └── AgentLoop.prompt()
        └── Vender.Adaptor.stream({ input, tools, systemPrompt })
            └── EventRound.splitIntoRounds / parseTurn（消息投影）
```

## 模块分层

| 路径 | 职责 |
|------|------|
| `protocol/events.ts` | 事件协议：`AgentEvent`、`EventType`（protocol 层仅此文件） |
| `agent/tool.ts` | `Tool.*` 类型定义 + `ToolRegistry` 注册与执行 |
| `agent/groupEventRounds.ts` | `EventRound.*`：按 round/turn 分组 events（context 裁剪、adaptor 投影） |
| `agent/contextBuilder.ts` | `Context.*`：rules/skills → systemPrompt，events 窗口裁剪 |
| `agent/agentLoop.ts` | `Loop.*`：LLM ↔ tool 循环 |
| `agent/agent.ts` | 会话编排、事件持久化、tool 调度 |
| `agent/store.ts` | `Session.*`：JSONL 持久化 |
| `ai/` | `Vender.*` + adaptor 工厂 |
| `cli/` | product rules、工具实现、入口 |

类型约定：各模块用 **namespace** 导出（`Context`、`Tool`、`Vender`、`Loop`、`Session`、`EventRound`）。

## Agent 配置

```typescript
// Vender.Config — ai/index.ts
// Context.BuildInput — agent/contextBuilder.ts

interface AgentConfig {
  sessionId: string;
  store?: SessionStoreInterface;
  vender: Vender.Config;
  context: Context.BuildInput;
}

interface AgentInterface {
  prompt(input: string): Promise<void>;
  on(listener: (event: SessionEvent) => void): () => void;
  registerTool(name: string, tool: Tool.Definition): void;
  interrupt(): void;
}
```

`Context.BuildInput`：

```typescript
namespace Context {
  type Rule = {
    layer: 'runtime' | 'product' | 'project';
    name: string;
    content: string;
    path?: string;
  };

  type BuildInput = {
    source: {
      rules?: Rule[];
      skills?: SkillIndex[];
    };
    contextBuildStrategy: {
      /** 单条 observation token 预算，超出 head 70% + tail 30% 截断 */
      maxSingleObservationToken?: number;
      /** 保留最近 N 个 round（按 meta.roundId） */
      keepRecentRounds?: number;
    };
  };
}
```

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
for await (const event of venderAdaptor.stream({ input: events, tools, systemPrompt })) { ... }
```

## 职责划分

```text
Agent
  owns canonicalEvents
  owns ToolRegistry（agent/tool.ts）
  owns Context.BuildInput
  schedules AgentLoop

AgentLoop
  pulls context snapshot（contextBuilder）
  pulls tool snapshot
  runs Vender.Adaptor stream
  executes Tool.Definition → ObservationEvent

ContextBuilder
  source.rules → systemPrompt
  events → 窗口裁剪 / observation 截断

EventRound（groupEventRounds.ts）
  groupByRoundId / splitIntoRounds / parseTurn
  供 contextBuilder 与 adaptor 使用，不属于 protocol
```

## Event Log

`AgentEvent[]` 是唯一事实源（`protocol/events.ts`）。

```text
InputEvent
ThoughtEvent | ThoughtDeltaEvent
ActionEvent*
ObservationEvent*
OutputEvent | OutputDeltaEvent
AgentStop
```

`ActionEvent` 触发 tool 执行并追加 `ObservationEvent`；无 action 时当前 user turn 结束。

## Vender Adaptor

Adaptor 把 canonical events 投影为厂商 API 格式；DeepSeek/OpenAI/Google 差异封装在 `ai/adaptors/` 内。

- 输入：`Vender.StreamInput`（events + tools + systemPrompt）
- 输出：`AsyncIterable<AgentEvent>`

## Tools

- 类型与注册：`agent/tool.ts`（`Tool.Meta`、`Tool.Definition`、`ToolRegistry`）
- 实现：`cli/tools/*`，通过 `Agent.registerTool()` 注册
- 模型返回 action → registry 查找 → `execute()` → observation

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
