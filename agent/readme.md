# Agent Runtime Architecture


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



  -> AgentManager
    -> AgentSession
      -> AgentLoop
        -> AiProvider
        -> ToolRegistry

  User Prompt
  └─ AgentSession
     ├─ enqueue job
     ├─ create AbortController
     └─ call AgentLoop
        ├─ emit input
        ├─ call AiProvider
        │  └─ adaptor converts eventLog to vendor messages
        ├─ receive thought/output/action
        ├─ execute tools
        │  └─ ToolRegistry -> ToolDefinition.execute()
        ├─ emit observation
        └─ loop until output / interrupt / error
     ├─ receive AgentEvent
     ├─ persist committed event via SessionStore
     └─ emit SessionEvent to UI/runtime

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

## Provider

Provider adapters translate the clean event log into vendor-specific messages. DeepSeek/OpenAI message details stay inside the adapter.

## Tools

Tools are registered in `ToolRegistry`. The model returns an action name and arguments; the agent looks up the tool, executes it, and records the result as an observation.


| 项目 | Session 设计核心 |
  |---|---|
  | Pi Agent | AgentSession 是一等对象，管理 lifecycle、message history、model state、compaction、event streaming。SessionManager 负责 inMemory / create /
  continueRecent / open / list。它还支持 id / parentId 树结构，方便 fork/branch。 |
  | Codex CLI | 一次连续终端对话就是一个 session，本地保存成 JSONL，路径类似 ~/.codex/sessions/YYYY/MM/DD/rollout-xxx.jsonl。session 里包含 session_meta、用
  户输入、模型输出、工具调用等。可以通过 session id resume。 |
  | Claude Code | session 明确定义为“绑定到项目目录的一段保存的 conversation”。支持 --continue、--resume、/resume、/branch、/compact。本地 transcript 在
  ~/.claude/projects/<project>/<session-id>.jsonl。 |
  | Vercel AI SDK | 更偏 UI/chat state，不是完整 agent session runtime。useChat 有 id、messages、status，可以传 id 共享同一个 chat 状态。持久化通常由应用自己
  做；Chat SDK 新增了 transcripts 概念，用于跨平台保存 conversation history。 |
  | OpenClaw | 更像 Gateway + Agent runtime。session 用来做路由、持久化和跨 channel 连接。它有 session-key / session-id，并把 session transcript 保存到类似
  ~/.openclaw/agents/<agentId>/sessions/<SessionId>.jsonl。 |