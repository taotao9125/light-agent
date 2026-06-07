# Model-View Agent Architecture

This document explains agent architecture from the model's point of view.

The goal is to reduce implementation complexity by asking one question first:

```txt
What does the model see, and what can the model ask the host to do?
```

## 1. Minimal Mental Model

An LLM does not directly execute actions, remember forever, read private files, search a knowledge base, or know runtime state.

The host provides those abilities around the model.

```txt
Agent Host
├── feeds conditioning input to the model
├── exposes structured actions to the model
├── executes requested actions
├── returns action results as observations
└── controls the loop
```

Compressed:

```txt
Agent = Context Builder + Action Executor + Loop Controller
```

Or:

```txt
Agent Host continuously builds context for the model,
executes selected actions,
and feeds action results back as new context.
```

## 2. Two Main Channels

From the model's view, most agent capabilities fall into two channels.

```txt
1. Host -> Model
   The host gives the model conditioning input.

2. Model -> Host -> Model
   The model requests an action.
   The host executes it.
   The result returns as observation.
```

## 3. Feed Model

These abilities give the model more or better conditioning input.

```txt
Feed Model
├── Rules
├── Skills
├── Memory
├── RAG documents
├── Event history
├── Runtime state
└── Context compression
```

### Rules

Model sees:

```txt
You must follow these constraints.
Do not modify unrelated files.
Prefer small scoped changes.
```

Essence:

```txt
Rules shape behavior.
```

### Skills

Model sees:

```txt
When doing task T, follow workflow W.
Use tool X only after checking condition Y.
Prefer output format Z.
```

Essence:

```txt
Skills are packaged task instructions.
```

Implementation boundary:

```txt
read skill file -> inject instruction text into context
```

### Memory

Model sees:

```txt
The user prefers concise Chinese explanations.
The user is preparing for Agent Developer roles by 2026-07-01.
The user prioritizes runnable demos over deep test coverage.
```

Essence:

```txt
Memory supplies persistent facts.
```

Implementation boundary:

```txt
memory store -> select relevant facts -> inject into context
```

### RAG Documents

If host injects RAG proactively, model sees:

```txt
Relevant document:
Source: agent/src/agent/agentLoop.ts
Text: The loop continues while tool actions exist...
```

Essence:

```txt
RAG supplies external/private knowledge.
```

Implementation boundary:

```txt
retrieve docs -> rank/filter -> inject passages into context
```

### Event History / Runtime State

Model sees:

```txt
User asked ...
Assistant replied ...
Tool returned ...
Current task status ...
Previous action failed because ...
```

Essence:

```txt
State tells the model what has happened so far.
```

Implementation boundary:

```txt
event log -> clean/project/truncate -> inject recent state
```

### Context Compression

Model sees:

```txt
Summary of earlier turns:
The user asked about MCP, RAG, skills, and model-view architecture.
The current unresolved goal is to build an interview-oriented agent capability roadmap.
```

Essence:

```txt
Compression preserves useful state under token limits.
```

Implementation boundary:

```txt
old history -> summary -> keep recent rounds + summary
```

## 4. Let Model Act

These abilities let the model ask the host to do something.

```txt
Let Model Act
├── Local tools
├── MCP tools
├── RAG-as-tool
├── Database/query tools
├── Browser/search tools
└── Write/edit tools
```

The model does not care whether the host executes the request through a local function, HTTP API, MCP server, database, browser, or another process.

The model only cares about:

```txt
1. What tools are available?
2. What arguments does each tool accept?
3. Can the host return the result as observation?
```

### Local Tool

Model emits:

```json
{
  "tool_name": "read_file",
  "arguments": {
    "path": "agent/src/agent/agentLoop.ts"
  }
}
```

Host executes local code and returns:

```json
{
  "tool_call_id": "call_1",
  "content": "file content..."
}
```

### MCP Tool

To the model, MCP tool looks like a normal tool.

Model emits:

```json
{
  "tool_name": "github_search_issues",
  "arguments": {
    "query": "agent loop"
  }
}
```

Host side:

```txt
MCP tools/list
-> convert MCP tool schema to local ToolDefinition
-> register local proxy tool
-> model calls proxy tool
-> proxy forwards to MCP tools/call
-> MCP result becomes observation
```

Essence:

```txt
MCP is not a new model capability.
MCP is a standardized host-side integration protocol.
```

More directly:

```txt
For the model:
MCP tool ~= normal tool

For the host:
MCP tool = remote discoverable standardized tool
```

### RAG-as-Tool

If RAG is exposed as a retrieval tool, model emits:

```json
{
  "tool_name": "search_docs",
  "arguments": {
    "query": "agent loop stopping conditions maxTurns abort tool calls",
    "top_k": 5
  }
}
```

Host executes retrieval and returns:

```json
{
  "tool_call_id": "call_2",
  "content": [
    {
      "source": "agent/src/agent/agentLoop.ts",
      "score": 0.87,
      "text": "The loop stops on final output, abort, or maxTurns..."
    }
  ]
}
```

Essence:

```txt
RAG can appear to the model as a search service.
```

But RAG does not have to be a tool:

```txt
Host-active RAG:
host retrieves -> host injects docs -> model only sees context

Model-active RAG:
model calls search_docs -> host retrieves -> observation returns
```

## 5. Capabilities by Model View

| Capability | Model sees / emits | Essence |
|---|---|---|
| Runtime loop | Repeated turns of input, output, observation | Loop controller |
| Context builder | Final messages | Conditioning input assembly |
| Rules | Behavior constraints | Instruction supply |
| Skills | Task workflow text | Packaged instruction supply |
| Memory | Remembered facts | Persistent context supply |
| RAG | Injected docs or search tool | Knowledge supply |
| Local tools | `tool_name + args` | Structured action interface |
| MCP | Normal-looking tools/resources/prompts | Host-side standard protocol |
| Event log | History/state after projection | State source |
| Observation | Tool result/error/status | New evidence or execution state |
| Provider adaptor | Usually invisible | API normalization |
| Compression | Summary of older context | Token-budget strategy |
| Eval | Invisible to model | Host-side quality check |

## 6. Interview-Oriented Task Pool

This table defines the task pool for the 2026-07-01 Agent Developer goal.

The table is not sorted by ROI. For the interview goal, every item is useful.

The practical sorting rule is:

```txt
1. Fit the market-facing agent capability map.
2. Prefer low-cost runnable integrations first.
3. Build the context/debug foundation before deeper strategy tuning.
4. Leave high-complexity polish until the core demo works.
```

So RAG, MCP, skills, and memory appear early not because the later items are unimportant, but because they are relatively cheap to connect to the current architecture and quickly expand the visible agent capability surface.

The work should be classified by two mainlines:

```txt
Mainline A: External Capability Integration
    Where do external abilities or information sources come from?

Mainline B: Context Assembly Strategy
    How does the host decide what the model should see?
```

There is also a base layer:

```txt
Agent Runtime:
    loop + tool execution + event log + provider adaptor
```

| Category | Task | Model view | Interview value | Cost / Complexity | Date | Minimum boundary |
|---|---|---|---|---|---|---|
| External Capability Integration | Expose RAG as tool | I can call `search_docs({ query })` when I lack external knowledge | Shows private/domain knowledge access | Low-Medium | 2026-06-04 | Register `search_docs`, return passages/sources/scores |
| External Capability Integration | Connect MCP tools | I see normal tools and emit `tool_name + args` | Shows standard external tool integration | Low-Medium | 2026-06-05 | `tools/list -> register proxy tool -> tools/call -> observation` |
| Context Assembly Strategy | Inspect context build | I can inspect what I actually saw | Shows context engineering, debugging, and control | Low | 2026-06-06 | Print final messages, source, priority, truncation reason |
| External Capability Integration | Load skills as instruction packages | I see task-specific workflow/rules | Covers skills as pluggable behavior | Low | 2026-06-07 | Read `skills/*.md`, inject into context |
| External Capability Integration | Add memory store | I have access to persistent user/project facts | Covers memory as an external state source | Low-Medium | 2026-06-08 | `memory.json`, add/list/select facts |
| Agent Runtime | Harden tool execution | I get success/error/timeout/permission observations | Shows production awareness in tool calling | Medium | 2026-06-09 | unknown tool, tool error, timeout, workspace guard |
| Agent Runtime | Resume session from event log | I see previous task state | Uses existing event log to prove state continuity | Low-Medium | 2026-06-10 | Load JSONL and restore canonical events |
| Agent Runtime | Normalize provider adaptor | Mostly invisible to me | Shows model/provider abstraction | Medium | 2026-06-11 | Normalize reasoning/output/tool_call/error |
| Context Assembly Strategy | Define context priority policy | I receive ordered context instead of random text | Shows strategy behind context assembly | Medium | 2026-06-12 | Document and implement priority order |
| Context Assembly Strategy | Add context budget report | I can see why some text was included or removed | Makes context strategy observable | Medium | 2026-06-13 | Report source, approximate tokens, truncation |
| Context Assembly Strategy | Add context compression | I see summary instead of full old history | Covers long-context pressure | Medium-High | 2026-06-14 | Summarize old rounds, keep recent rounds |
| Context Assembly Strategy | Add host-active RAG path | I see docs already injected before reasoning | Shows proactive context supply | Medium | 2026-06-15 | Simple route: need docs -> retrieve -> inject |
| External Capability Integration | Add memory write/update path | Future turns can see new remembered facts | Shows memory lifecycle beyond static facts | Medium | 2026-06-16 | Add/update/delete memory facts manually or by command |
| Context Assembly Strategy | Add skill selection | I only see relevant skills | Shows control over instruction pollution | Medium | 2026-06-17 | Select by explicit name or simple matcher |
| Agent Runtime | Add run trace view | I can inspect loop turns, actions, and observations | Strong demo/debugging value | Medium | 2026-06-18 | Show rounds, tool calls, observations, stop reason |
| Agent Runtime | Simple eval harness | Invisible to me | Shows quality mindset, lower market priority | Low-Medium | 2026-06-19 | Run 5-10 fixed tasks and record result |
| Demo & Packaging | Design full scenario | I use memory, skill, RAG, MCP, tools in one flow | Converts features into interview narrative | Low | 2026-06-20 | One coherent project/domain demo script |
| Demo & Packaging | Implement full scenario | I run through the complete agent loop | Proves integration instead of isolated features | Medium-High | 2026-06-21 to 2026-06-23 | End-to-end runnable demo |
| Demo & Packaging | Write architecture explanation | Interviewer can understand your design quickly | Turns implementation into a story | Low | 2026-06-24 | One diagram + one model-view explanation |
| Demo & Packaging | Write resume bullets | Recruiter sees keywords and outcomes | Necessary for July 1 delivery | Low | 2026-06-25 | 3-5 bullets: runtime, MCP, RAG, memory, context |
| Demo & Packaging | Prepare interview Q&A | You can defend tradeoffs and boundaries | Converts work into answers | Medium | 2026-06-26 to 2026-06-28 | 20-30 layered questions |
| Demo & Packaging | Fix rough edges | Reduces demo failure risk | Practical before application | Unknown | 2026-06-29 to 2026-06-30 | Fix only blockers and obvious UX/debug gaps |

## 7. Implementation Decision Rule

When adding a new agent capability, ask:

```txt
Does this give the model more conditioning input?
=> Context Supply

Does this let the model ask the host to do something?
=> Tool / Action

Does this preserve what happened across turns?
=> Event / State

Does this hide provider-specific API differences?
=> Provider Adapter
```

## 8. Core Summary

```txt
Agent engineering is mostly about:

1. deciding what the model can see
2. deciding what the model can ask the host to do
3. executing those actions safely
4. feeding results back as context
5. controlling when the loop continues or stops
```

In this view:

```txt
Skills / rules / memory / RAG docs / history
= ways to condition the model

Tools / MCP tools / RAG-as-tool
= ways for the model to request host actions

Observations / event log
= ways to convert execution and runtime state back into future context
```
