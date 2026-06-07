# Agent Runtime Architecture


```text
CLI
└── new Agent(config)
    └── Agent.constructor(config)
        └── new AgentLoop({ vender })
            └── AgentLoop.constructor({ vender })
                └── createClient(vender)
                    └── Vender.Adaptor
```

## agent interface

```typescript

type Rule = {
  name?: string;
  path?: string;
  content: string;
}


type Vender = {
   /** 厂商名 {@example "deepseek"} */
    name: string;
    /** api key */
    apiKey: string;
    /** base url */
    baseURL: string;
    /** 模型名称 {@example "deepseek-v4-flash"} */
    model: string;
}

interface AgentClassConfig {
  /** 厂商 */
  vender: Vender,
  context: {
    source: {
      /** 自定义 rule */
      rules: Rule[]
    },
    /** 上下文构建策略 */
    buildStrategy: {
      /** 单个 tool call 结果的 token 预算，超过会裁剪(head: 70%, tail: 30%) */
      maxSingleObservationTokenBudget: number;
      /** 保留最近的对话轮数 */
      keepRecentRounds: number;
    }
  }
}

decalare class Agent {
  constructor(config: AgentClassConfig);
  prompt(input: string): Promise<void>;
  on(listener: (event: RuntimeEvent) => void);
  registerTool(name: string, tool: ToolDefinition) => void;
  interrupt: () => void;
  
}

```

## agent loop interface
```typescript
interface AgentLoopClassConfig = {
  vender: Vender,
  strategy: {
    maxTurns: number;
  },
  // deps: {

  // }
}


type Deps = {
    abortSignal: abortSignal;
    pullContextSnap: () => Context;
    pullToolsSnap: () => ToolDefinition[];
    pullVenderConfigSnap: () => VenderConfig
}

decalare class AgentLoop {
  private venderAdaptor: Vender.Adaptor
  constructor(config: AgentLoopClassConfig) {
    this.venderAdaptor = createClient(AgentLoopClassConfig.vender);
    // this.deps = config.deps;
    // this.venderClient.stream()
  },
  prompt(prompt: string: deps: Deps )
}



/**
const {
  systemPrompt,
  events
} = this.deps.pullContextSnap();

const toolsMeta =  toToolsMeta(this.deps.pullToolsSnap());

this.venderAdaptor.stream({
  model: this.model,
  input: events,
  systemPrompt: systemPrompt
  tools: toolsMeta,
})
**/

```

## 底层 event 流演进

user
  turn1_thought
  turn1_action
  turn1_observation
  turn2_thoight
  turn2_action
  turn2_observation
  turn3_thought

user
  assistant(turn1_thought + turn1_action)
  tool(turn1_observation)
  assistant(turn2_thought + turn2_action)
  tool(turn2_observation)
  assistant(turn3_thought + output)

  Agent
    owns canonicalEvents
    owns toolRegistry
    owns contextSource
    schedules AgentLoop

  AgentLoop
    pulls latest context snapshot
    pulls latest tool snapshot
    runs vender adaptor stream

  ContextBuilder
    builds systemPrompt + events

## Event Log

`AgentEvent[]` is the source of truth.

The runtime records events in order:

```text
InputEvent
ThoughtEvent
ActionEvent*
ObservationEvent*
OutputEvent
```

`OutputEvent` marks the end of one LLM turn and may be empty. `ActionEvent` decides whether the agent loop continues: if actions exist, tools run and observations are appended; if no action exists, the current user turn is done.

## Agent

`Agent.prompt()` appends user input to the event log, streams model events, executes requested tools, appends observations, and emits events for the CLI or future UI layers.

## Vender Adaptor

Vender adaptors translate the clean event log into vendor-specific messages. DeepSeek/OpenAI message details stay inside the adaptor.

## Tools

Tools are registered in `ToolRegistry`. The model returns an action name and arguments; the agent looks up the tool, executes it, and records the result as an observation.


| 项目                                                                  | Session 设计核心                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Pi Agent                                                            | AgentSession 是一等对象，管理 lifecycle、message history、model state、compaction、event streaming。SessionManager 负责 inMemory / create / |
| continueRecent / open / list。它还支持 id / parentId 树结构，方便 fork/branch。 |                                                                                                                              |
| Codex CLI                                                           | 一次连续终端对话就是一个 session，本地保存成 JSONL，路径类似 ~/.codex/sessions/YYYY/MM/DD/rollout-xxx.jsonl。session 里包含 session_meta、用              |
| 户输入、模型输出、工具调用等。可以通过 session id resume。                              |                                                                                                                              |
| Claude Code                                                         | session 明确定义为“绑定到项目目录的一段保存的 conversation”。支持 --continue、--resume、/resume、/branch、/compact。本地 transcript 在                    |
| ~/.claude/projects//.jsonl。                                         |                                                                                                                              |
| Vercel AI SDK                                                       | 更偏 UI/chat state，不是完整 agent session runtime。useChat 有 id、messages、status，可以传 id 共享同一个 chat 状态。持久化通常由应用自己                     |
| 做；Chat SDK 新增了 transcripts 概念，用于跨平台保存 conversation history。         |                                                                                                                              |
| OpenClaw                                                            | 更像 Gateway + Agent runtime。session 用来做路由、持久化和跨 channel 连接。它有 session-key / session-id，并把 session transcript 保存到类似            |
| ~/.openclaw/agents//sessions/.jsonl。                                |                                                                                                                              |


# 记忆焦点测试过程

- 尝试 关键词事实问答：直接问“工具唯一事实源是什么”，答案是 ToolDefinition。
无法测试出焦点注意力，因为答案太短、太显眼，模型只要做关键词检索就能答对。
- 再尝试 加入旧结论噪音：在上下文中加入 “ToolMeta 是事实源” 等错误历史。
仍然不够有效，因为噪音里带有“旧历史、不代表当前事实”等标签，模型很容易自动降权。
- 再尝试 LLM-as-judge：用第二次模型调用判断候选答案是否语义正确。
解决了硬匹配问题，但没有解决测试本身太简单的问题。
- 再尝试 调整事实位置：把正确事实放到最前面，把噪音放在事实和最终问题之间。
开始更接近焦点注意力测试，因为模型必须在后续长上下文之后仍然记住早期事实。
- 再尝试 去掉显眼噪音标记：删除 NOISE_BLOCK、序号、固定重复顺序。
让噪音不再像人工合成数据，减少模型识别“这是噪音”的线索。
- 再尝试 去掉自我降权词：删除 old、draft、TODO、legacy、prototype 等前缀。
让错误材料不再主动暴露“我是旧资料”，而是更像正式上下文。
- 再尝试 正式错误 ADR：把错误噪音写成 Architecture Decision Record、Decision、Runtime boundary 等权威
文档。
开始有效测试上下文污染，因为错误材料和正确事实具有相近权重。
- 再尝试 去掉 input/thought 里的历史线索：删除“旧设计、历史 review、旧架构文档”等表达。
进一步减少模型自动降权错误材料的机会。
- 再尝试 删除 noise thought：噪音结构从 input -> thought -> action -> observation -> output 改为 input
-> action -> observation -> output。
避免混入“过去 assistant 错误推理”的变量，让测试更聚焦在历史材料和工具结果污染。
- 再尝试 opaque label：用 ZetaUnit / KappaView 替代 ToolDefinition / ToolMeta。
验证了语义命名本身会泄漏答案；但为了报告可读性，最后又改回真实概念名。
- 再尝试 事实问答改成方案生成：不再问“谁是 runtime contract”，而是让模型设计动态 registerTool 方案。
更接近真实 agent 场景，因为测试的是模型执行任务时是否被上下文污染。
- 再尝试 强约束规则：早期写 Never / must / any 这类项目约束。
能测出规则遵守，但太像 prompt injection/系统规则测试，不像真实用户自然定义概念。
- 最后尝试 中性项目术语定义：把早期内容改成 Project runtime terminology，不用命令语气，只定义
ToolDefinition 和 ToolMeta 的含义。
这是目前最合理的一版：它测试的是模型在长上下文后，是否还能保持早期项目内自定义概念，而不是靠常识、关
键词或强规则。

结论：
 thought 很影响记忆焦点
 约束规则 很影响记忆力焦点