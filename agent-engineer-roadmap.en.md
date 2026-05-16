# 1-Month Sprint Plan for Becoming an Agent Engineer

Goal: complete a demonstrable and explainable TypeScript Agent Runtime project within 1 month, suitable for Agent engineering interviews.

## 0. Final Deliverable

View the project shape with two diagrams: the first shows module ownership, and the second shows runtime communication. Do not mix folder containment and call relationships into the same arrow.

Module ownership diagram:

```text
agent-runtime/
  src/
    cli/
      cli.ts                    # terminal entry

    server/
      websocket.ts              # WebSocket entry

    protocol/
      messages.ts               # ClientMessage / ServerEvent

    agent/
      AgentSession.ts           # session facade: prompt / abort / event
      AgentLoop.ts              # core loop: model -> tool -> model
      AgentEvent.ts             # internal event protocol

    ai/
      AiProvider.ts             # unified provider interface
      OpenAIProvider.ts         # OpenAI adapter
      DeepSeekProvider.ts       # DeepSeek adapter

    tools/
      Tool.ts                   # tool interface
      ToolRegistry.ts           # name -> Tool
      builtins/readFile.ts
      searchDocs.ts             # RAG exposed as a tool

    rag/
      chunk.ts
      embed.ts
      vectorStore.ts
      retriever.ts

    mcp/
      McpClient.ts
      McpToolAdapter.ts         # MCP tool -> internal Tool, stretch item

    test/
      fakeProvider.ts
      AgentTestHarness.ts
```

Runtime communication diagram:

```text
Legend:
  -->  in-process function call
  ~~>  async event stream / AsyncIterable
  ==>  network communication
  ..>  registration / adaptation, not something that happens on every prompt

CLI
  --> AgentSession.prompt(input)

WebSocket Client
  ==> WebSocket Server
  --> AgentSession.prompt(input)

AgentSession
  --> AgentLoop.run(messages, provider, tools)
  ~~> CLI Renderer / WebSocket Sender / Logger

AgentLoop
  ~~> AiProvider.stream(request)
  --> ToolRegistry.get(toolName)
  --> Tool.execute(args)

AiProvider Adapter
  ==> OpenAI / DeepSeek API

search_docs Tool
  --> Retriever.search(query)
  --> VectorStore.search(embedding)

MCP Tool
  --> McpToolAdapter
  ==> MCP Server
  # stretch item; do not block the RAG / testing main line

FakeProvider
  ..> only replaces the real AiProvider in tests
```

Final demos:

- Enter a prompt in the CLI and have the agent call a tool.
- Receive streaming events from a WebSocket client.
- Support two providers, such as OpenAI / DeepSeek.
- Support local tools and RAG tools.
- Support simple RAG retrieval.
- Stretch: support an MCP tool adapter.
- Test the agent loop with a fake provider.

Final interview pitch:

```text
I implemented a TypeScript Agent Runtime.
CLI and WebSocket do not operate the agent loop directly; they go through AgentSession.
AgentLoop only consumes unified AiProvider events and does not care about specific vendor SDKs.
Local tools and RAG tools are registered into ToolRegistry through the same Tool interface; MCP tool adapter can extend the same interface.
Tests use FakeProvider to simulate model events and verify tool calls and context write-back deterministically.
```

## 1. Overall Architecture

### Layer Relationship

```text
External entries
  CLI
    -> direct function call to AgentSession.prompt()

  WebSocket Client
    -> WebSocket JSON message
    -> WebSocket Server
    -> function call to AgentSession.prompt()

Core runtime
  AgentSession
    -> function call to runAgentLoop()
    -> EventEmitter / callback broadcasts AgentEvent outward

  AgentLoop
    -> consumes AiProvider.stream() through AsyncIterable
    -> function call to ToolRegistry.get()
    -> function call to Tool.execute()

AI layer
  AiProvider interface
    -> OpenAIProvider calls OpenAI SDK or HTTP API
    -> DeepSeekProvider calls OpenAI-compatible HTTP API

Tool layer
  ToolRegistry
    -> read_file local function call
    -> list_files local function call
    -> search_docs calls Retriever
    -> MCP tool calls MCP Client
```

### Communication Overview

There are several types of "communication" here. Do not mix them together.

| Location | Communication Method | Transmitted Content | Why |
|---|---|---|---|
| CLI -> AgentSession | Function call | `prompt(input)` | Same process, no network protocol needed |
| WebSocket Client -> Server | WebSocket JSON | `ClientMessage` | Cross-process / frontend-backend bidirectional communication |
| WebSocket Server -> AgentSession | Function call | `prompt(text)` / `abort()` | Server and runtime are in the same process |
| AgentSession -> CLI/WebSocket | EventEmitter / callback | `AgentEvent` | One session event can be consumed by CLI, WebSocket, and logs |
| AgentSession -> AgentLoop | Function call + `AsyncIterable` | `runAgentLoop(input)` | Session drives one agent turn |
| AgentLoop -> AiProvider | `AsyncIterable` | `provider.stream()` produces `AgentEvent` | Model output is a streaming process |
| AiProvider -> vendor API | SDK / HTTP streaming | OpenAI/DeepSeek chunk | Vendor protocol details stay inside the adapter |
| AgentLoop -> ToolRegistry | Function call | `get(toolName)` | Local runtime capability lookup |
| AgentLoop -> Tool | Function call returning Promise | `execute(args)` | A tool is a local command object |
| MCP Tool -> MCP Server | MCP transport, such as stdio / HTTP / WebSocket | MCP tool call | External tool protocol does not leak into AgentLoop |
| RAG Tool -> Retriever | Function call | `search(query, topK)` | RAG is a local capability exposed as a tool |

### Overview Sequence Diagram

This diagram only describes the main path for one prompt. It does not represent folder ownership; it represents runtime communication.

```text
User
  -> Entry: prompt
     Entry = CLI or WebSocket Server

Entry
  -> AgentSession: prompt(input)

AgentSession
  -> AgentLoop: runAgentLoop(messages, provider, tools)

AgentLoop
  -> AiProvider: stream(request)
  -> LLM API: SDK / HTTP streaming request
  <- AiProvider: vendor chunks normalized as AgentEvent

AgentLoop
  -> AgentSession: AgentEvent
  -> Output: emit event
  -> User: terminal output or WebSocket ServerEvent

If tool_call happens:
  AgentLoop
    -> ToolRegistry/Tool: execute(args)
    <- ToolRegistry/Tool: tool result
    -> messages: append tool result
    -> AiProvider: continue with updated messages
```

### Two Main Flows

#### CLI Flow

```text
User input
  -> CLI reads stdin
  -> session.prompt(text)
  -> runAgentLoop()
  -> provider.stream()
  -> AgentEvent
  -> session.emit(event)
  -> CLI renderer prints to terminal
```

#### WebSocket Flow

```text
Browser / ws-client
  -> sends ClientMessage through WebSocket
  -> WebSocket server parses JSON
  -> sessionManager.getOrCreate(sessionId)
  -> session.prompt(text)
  -> runAgentLoop()
  -> provider.stream()
  -> session.emit(event)
  -> WebSocket server converts to ServerEvent
  -> ws.send(JSON.stringify(event))
```

### Tool Call Flow

```text
AiProvider produces a tool_call event
  -> AgentLoop receives tool_call
  -> ToolRegistry.get(event.name)
  -> tool.execute(event.args)
  -> AgentLoop produces tool_result event
  -> tool result is appended to messages
  -> AgentLoop continues requesting the provider
```

### RAG Flow

RAG does not directly insert itself into AgentLoop. It is exposed as a tool:

```text
Model decides to call search_docs
  -> AgentLoop executes search_docs tool
  -> search_docs calls Retriever.search(query)
  -> Retriever calls Embedder.embed(query)
  -> VectorStore.search(embedding, topK)
  -> returns RetrievedChunk[]
  -> tool_result is written back into messages
```

### MCP Flow

MCP also does not directly insert itself into AgentLoop. It is adapted into the internal `Tool` interface:

```text
At startup
  MCP Client listTools()
  -> McpToolAdapter
  -> ToolRegistry.register(tool)

At runtime
  Model produces a tool_call for an MCP tool
  -> AgentLoop queries ToolRegistry
  -> tool.execute(args)
  -> McpClient.callTool(name, args)
  -> MCP server returns result
  -> tool_result is written back into messages
```

### Data Flow

```text
prompt
  -> AgentSession.prompt()
  -> append user message
  -> runAgentLoop()
  -> provider.stream()
  -> AgentEvent
  -> if tool_call: ToolRegistry.get(name).execute(args)
  -> append tool result
  -> continue model loop
  -> emit events to CLI/WebSocket
```

### Core Principles

- CLI/WebSocket only handle input and output. They do not directly run the agent loop.
- AgentSession handles session, events, abort, and messages.
- AgentLoop handles the tool-call loop.
- AiProvider hides vendor SDK differences.
- ToolRegistry handles runtime registration and lookup of name -> tool.
- RAG is integrated as a tool. MCP follows the same shape, but it is a stretch item and should not block the main line.
- Prefer FakeProvider in tests instead of real models.

## 2. Core Interface Contracts

<details>
<summary>Expand core interface contracts</summary>

These interfaces are the main line across all 4 weeks. Lock them down first; each week only adds implementations.

Use one consistent reading frame:

- **Position**: which layer the interface belongs to.
- **Upstream**: who hands control or data to it.
- **Downstream**: who it hands control or data to.
- **Input**: what it receives.
- **Output**: what it produces.
- **Communication**: function call, event, AsyncIterable, WebSocket, etc.
- **Boundary**: what it must not do.

### 2.1 Entry Protocol

| Item | Content |
|---|---|
| Position | WebSocket entry protocol layer |
| Upstream | WebSocket client |
| Downstream | WebSocket server, then AgentSession |
| Input | `ClientMessage` |
| Output | `ServerEvent` |
| Communication | WebSocket JSON |
| Boundary | Only converts network protocol; does not run AgentLoop and does not call provider directly |

```ts
export type ClientMessage =
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "abort"; sessionId: string };

export type ServerEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; sessionId: string; text: string }
  | { type: "tool_call"; sessionId: string; name: string; args: unknown }
  | { type: "tool_result"; sessionId: string; name: string; result: unknown }
  | { type: "done"; sessionId: string }
  | { type: "error"; sessionId: string; message: string };
```

### 2.2 Session Layer

| Item | Content |
|---|---|
| Position | Runtime facade shared by CLI and WebSocket |
| Upstream | CLI or WebSocket server |
| Downstream | AgentLoop; also sends AgentEvent to CLI/WebSocket/Logger |
| Input | user prompt, abort request, initialization config |
| Output | AgentEvent, updated messages |
| Communication | Upstream uses function calls; calls AgentLoop by function; outputs through callback/EventEmitter |
| Boundary | Does not handle vendor SDK details, does not implement concrete tools, does not define WebSocket protocol |

```ts
export interface AgentSessionOptions {
  id: string;
  cwd: string;
  provider: AiProvider;
  tools: ToolRegistry;
  initialMessages?: Message[];
}

export class AgentSession {
  readonly id: string;

  onEvent(handler: (event: AgentEvent) => void): () => void;
  prompt(input: string): Promise<void>;
  abort(): void;
  getMessages(): Message[];
}
```

### 2.3 Agent Loop Layer

| Item | Content |
|---|---|
| Position | Core agent loop layer |
| Upstream | AgentSession |
| Downstream | AiProvider, ToolRegistry, Tool |
| Input | messages, provider, tools, cwd, signal |
| Output | AgentEvent; may mutate messages by appending assistant/tool result |
| Communication | Called by AgentSession as a function; yields events through AsyncIterable; calls tools as functions |
| Boundary | Does not care about CLI/WebSocket, does not care about specific provider SDKs, does not special-case RAG/MCP |

```ts
export interface AgentLoopInput {
  messages: Message[];
  provider: AiProvider;
  tools: ToolRegistry;
  cwd: string;
  signal?: AbortSignal;
}

export async function* runAgentLoop(input: AgentLoopInput): AsyncIterable<AgentEvent>;
```

### 2.4 AI Layer

| Item | Content |
|---|---|
| Position | AI provider adapter layer |
| Upstream | AgentLoop |
| Downstream | Vendor SDK or HTTP API such as OpenAI / DeepSeek |
| Input | `AiRequest`: messages, tools, signal |
| Output | `AsyncIterable<AgentEvent>` |
| Communication | AgentLoop consumes with AsyncIterable; provider internally uses SDK/HTTP streaming |
| Boundary | Does not execute tools, does not save sessions, does not care about CLI/WebSocket; only converts vendor protocol into AgentEvent |

```ts
export interface AiRequest {
  messages: Message[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface AiProvider {
  name: string;
  stream(request: AiRequest): AsyncIterable<AgentEvent>;
}
```

### 2.5 Tool Layer

| Item | Content |
|---|---|
| Position | Tool capability layer |
| Upstream | AgentLoop looks up tools from tool_call |
| Downstream | Local functions, RAG Retriever, MCP Client |
| Input | tool name, args, ToolContext |
| Output | tool result |
| Communication | ToolRegistry uses Map lookup; Tool.execute returns Promise |
| Boundary | Tool does not call the model and does not manage session; RAG/MCP must be adapted into Tool instead of invading AgentLoop |

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

### 2.6 Shared Data: Message / AgentEvent

These types pass across multiple layers. They are the data contracts of the runtime. This section describes where the data flows, not who calls whom.

#### Message

| Item | Content |
|---|---|
| Position | Session history data |
| Upstream | AgentSession adds user messages; AgentLoop adds assistant/tool messages |
| Downstream | AiProvider reads messages; AgentSession stores messages |
| Input | user input, model output, tool result |
| Output | context for the next model request |
| Communication | Plain object array passed between session/loop/provider |
| Boundary | Message is data only; it contains no execution logic |

```ts
export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}
```

#### AgentEvent

| Item | Content |
|---|---|
| Position | Runtime event protocol |
| Upstream | AiProvider produces model events; AgentLoop produces tool_result; AgentSession forwards |
| Downstream | CLI renderer, WebSocket sender, Logger, tests |
| Input | model stream chunk, tool execution result, error |
| Output | unified event consumable by UI/WebSocket/logs |
| Communication | AsyncIterable + callback/EventEmitter |
| Boundary | AgentEvent is a runtime process event, not the same thing as the final assistant message |

```ts
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "done" }
  | { type: "error"; message: string };
```

</details>

## 3. Execution Priority

If time gets tight, protect deliverables in this order:

```text
P0: AgentSession + AgentLoop + AiProvider + ToolRegistry
P0: CLI demo runs the tool-call loop
P0: WebSocket event protocol
P0: RAG search_docs tool
P0: FakeProvider tests

P1: DeepSeek as second provider
P1: abort / timeout / traceId
P1: README + architecture.md + protocol.md

P2: MCP Tool Adapter
P2: fuller error recovery
P2: nicer CLI output
```

Rule:

```text
Do not work on P2 until P0 is done.
If MCP gets stuck for more than half a day, pause it and return to RAG / tests / docs.
```

## 4. Daily Rhythm

<details>
<summary>Expand daily rhythm</summary>

Normal day:

```text
09:30 - 12:00  Deep coding
12:00 - 14:00  Meal + rest
14:00 - 16:30  Study + implementation
16:30 - 17:00  Review notes
19:30 - 21:00  Interview explanation / docs / resume
```

Exercise day:

```text
09:30 - 12:00  Deep coding
12:00 - 13:30  Meal
14:00 - 17:00  Exercise / outside
19:30 - 21:30  Light tasks: docs, review, source reading
```

Daily review:

```text
What I completed today:
What problem I hit:
First thing tomorrow:
Architecture point I learned today:
One sentence I can use in interviews:
```

</details>

## 5. Week 1: Agent Runtime Skeleton

<details>
<summary>Expand Week 1 detailed plan</summary>

### Goal

Refactor the existing "SDK + messages + loop" into a layered Agent Runtime.

### Modules to Deliver

```text
src/agent/AgentEvent.ts
src/agent/AgentLoop.ts
src/agent/AgentSession.ts
src/ai/AiProvider.ts
src/ai/OpenAIProvider.ts
src/ai/DeepSeekProvider.ts
src/tools/Tool.ts
src/tools/ToolRegistry.ts
src/tools/builtins/readFile.ts
src/cli/cli.ts
```

### Completion Criteria

- `AgentEvent` is defined.
- `AiProvider` is defined.
- `Tool` / `ToolRegistry` are defined.
- `AgentLoop` can handle one tool call.
- `AgentSession.prompt()` can drive the loop.
- CLI can run `read_file`.

Acceptance:

```text
CLI input: help me read package.json
Model triggers read_file
tool result is written back to messages
Model continues and produces the final answer
```

### Patterns to Borrow from pi

| Pattern / Concept | Problem It Solves | How You Use It |
|---|---|---|
| Facade | Entry layers should not know internal complexity | `AgentSession.prompt(input)` wraps loop/messages/events |
| Event Stream | Model output is a process, not a final string | Use `AgentEvent` for text/tool/done/error |
| Registry | Avoid tool if/else chains | `ToolRegistry` uses `Map<string, Tool>` |
| Command | Tool call is name + args -> execute | Each tool is `{ name, execute }` |
| Pipeline | Input to output should flow through layers | prompt -> session -> loop -> provider/tool -> event |

Focus for this week:

```text
CLI does not call the provider directly.
AgentLoop does not directly depend on a specific SDK.
Tool execution is not a central switch; tools are registered in ToolRegistry.
```

### Daily Plan

Day 1:

- Organize the project directory.
- Define `Message`, `AgentEvent`, `AiProvider`, and `Tool`.
- Write a first README architecture sketch.

Day 2:

- Implement `ToolRegistry`.
- Implement `read_file` or `list_files`.

Day 3:

- Morning: implement the basic `AgentLoop` while loop.
- Afternoon: exercise.
- Evening: write AgentLoop design notes.

Day 4:

- Implement OpenAI or DeepSeek provider adapter.
- Provider outputs unified `AgentEvent`.

Day 5:

- Implement `AgentSession.prompt()`.
- CLI only calls session.

Day 6:

- Exercise.
- Fix bugs.
- Add README architecture diagram.

Day 7:

- Integrate CLI demo.
- Write Week 1 review.

</details>

## 6. Week 2: WebSocket + Event Protocol

<details>
<summary>Expand Week 2 detailed plan</summary>

### Goal

Expose the Agent Runtime as a WebSocket service callable by a frontend or another service.

### Modules to Deliver

```text
src/protocol/messages.ts
src/server/websocket.ts
src/session/SessionManager.ts
src/trace/trace.ts
scripts/ws-client.ts
```

### Interface Contracts

```ts
export type ClientMessage =
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "abort"; sessionId: string };

export type ServerEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; sessionId: string; text: string }
  | { type: "tool_call"; sessionId: string; name: string; args: unknown }
  | { type: "tool_result"; sessionId: string; name: string; result: unknown }
  | { type: "done"; sessionId: string }
  | { type: "error"; sessionId: string; message: string };

export class SessionManager {
  getOrCreate(sessionId: string): AgentSession;
  abort(sessionId: string): void;
  remove(sessionId: string): void;
}

export interface TraceContext {
  traceId: string;
  sessionId: string;
  startedAt: number;
}
```

### Completion Criteria

- WebSocket server can start.
- Client can send prompt.
- Server can push `text_delta/tool_call/tool_result/done`.
- Supports abort.
- Supports timeout.
- Logs contain `traceId` and `sessionId`.
- CLI and WebSocket share `AgentSession`.

### Patterns to Borrow from pi

| Pattern / Concept | Problem It Solves | How You Use It |
|---|---|---|
| Observer / Pub-Sub | Multiple consumers need to react to the same event | WebSocket subscribes to session events |
| Protocol Adapter | Internal events and external protocol differ | `AgentEvent` -> `ServerEvent` |
| Session Manager | Multiple sessions need management | `sessionId -> AgentSession` |
| Cancellation Boundary | Users need to interrupt long tasks | `AbortController` through session/loop/provider |
| Trace Context | Debugging needs one full request path | Each prompt has `traceId/sessionId` |

Focus for this week:

```text
WebSocket is not a new AgentLoop.
WebSocket is only a protocol layer.
```

### Daily Plan

Day 8:

- Define `ClientMessage` / `ServerEvent`.
- Implement basic WebSocket server.

Day 9:

- Connect WebSocket to `AgentSession`.
- Push session events.

Day 10:

- Morning: implement `SessionManager`.
- Afternoon: exercise.
- Evening: draft protocol docs.

Day 11:

- Implement `abort`.
- Pass `AbortSignal` into session/loop/provider.

Day 12:

- Implement timeout.
- Add `traceId/sessionId` logs.

Day 13:

- Exercise.
- Write `scripts/ws-client.ts`.
- Fix protocol issues.

Day 14:

- Integrate CLI + WebSocket.
- Write Week 2 review.

</details>

## 7. Week 3: RAG + MCP

<details>
<summary>Expand Week 3 detailed plan</summary>

### Goal

RAG is the main line for this week. MCP should be a minimal adapter whose purpose is to prove that an external tool protocol can be normalized into the internal Tool interface. Do not try to build a full MCP platform.

Core goal: integrate RAG as a tool in the Agent Runtime. The minimal MCP adapter follows the same idea, but it must not invade AgentLoop.

### Modules to Deliver

```text
src/rag/chunk.ts
src/rag/embed.ts
src/rag/vectorStore.ts
src/rag/retriever.ts
src/tools/searchDocs.ts
src/mcp/McpClient.ts
src/mcp/McpToolAdapter.ts
```

### Interface Contracts

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

### Completion Criteria

Must complete:

- Load `docs/`.
- Chunk documents.
- Embed chunks.
- In-memory vector store.
- `search_docs` tool.
- Answers include citations.

Try to complete:

- Connect one MCP server.
- Convert MCP tool into internal `Tool` and register it.

### Patterns to Borrow from pi

| Pattern / Concept | Problem It Solves | How You Use It |
|---|---|---|
| Adapter | External protocol and internal interface differ | MCP tool -> internal `Tool` |
| Repository / Store | Storage implementation may change | `VectorStore` starts in memory, can later swap DB |
| Tool as Capability | External capabilities become tools | RAG enters ToolRegistry; MCP can use the same shape as a stretch item |
| Retrieval Pipeline | Retrieval flow needs layers | load -> chunk -> embed -> search -> result |
| Boundary Isolation | AgentLoop should not know RAG/MCP details | AgentLoop only executes tools |

Focus for this week:

```text
RAG should become a tool. If MCP is implemented, it should also become a tool.
AgentLoop does not know where a tool comes from.
```

### Daily Plan

Day 15:

- Implement document loading.
- Implement chunking.

Day 16:

- Connect embedding.
- Implement in-memory vector store.

Day 17:

- Morning: implement retriever.
- Afternoon: exercise.
- Evening: write RAG data-flow docs.

Day 18:

- Implement `search_docs` tool.
- Let the agent actively call the retrieval tool.

Day 19:

- Connect MCP client.
- List MCP server tools.

Day 20:

- Adapt MCP tool into internal `Tool`.
- Register into `ToolRegistry`.
- If MCP gets stuck, stop digging and protect the RAG, testing, and docs main line.

Day 21:

- Integrate RAG demo.
- If MCP is complete, add MCP demo.
- Write Week 3 review.

</details>

## 8. Week 4: Tests + Docs + Interview Explanation

<details>
<summary>Expand Week 4 detailed plan</summary>

### Goal

Polish the project into something demonstrable, testable, and explainable in interviews.

### Modules to Deliver

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

### Interface Contracts

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
  session: AgentSession;
  prompt(input: string): Promise<AgentEvent[]>;
  messages(): Message[];
}
```

### Completion Criteria

- FakeProvider.
- AgentLoop tests.
- Tool call tests.
- RAG tests.
- WebSocket demo.
- Abort tests.
- README.
- `docs/architecture.md`.
- `docs/protocol.md`.
- Resume project description.
- 5-minute project explanation script.

### Patterns to Borrow from pi

| Pattern / Concept | Problem It Solves | How You Use It |
|---|---|---|
| Harness | Agent behavior is complex and cannot rely only on manual testing | `AgentTestHarness` |
| Deterministic Test Stream | Real models are unstable | FakeProvider emits fixed events |
| Contract Test | Test layer contracts, not SDKs | Test `AiProvider -> AgentEvent`, `Tool -> result` |
| Event Log Thinking | Agent behavior is observed through events | Tests assert event sequences |
| Documentation as Architecture | Architecture must be explainable | `architecture.md` / `protocol.md` |

Focus for this week:

```text
Good agent engineering cannot rely only on manual testing with real models.
You need FakeProvider to reproduce tool call, RAG, abort, and error paths deterministically.
```

### Daily Plan

Day 22:

- Implement FakeProvider.
- Write AgentLoop tests.

Day 23:

- Morning: write tool call tests.
- Afternoon: exercise.
- Evening: fix test issues.

Day 24:

- Write RAG tests.
- Write WebSocket demo script.

Day 25:

- Write `docs/architecture.md`.
- Draw complete data flow.

Day 26:

- Write `docs/protocol.md`.
- Organize WebSocket message protocol.

Day 27:

- Exercise.
- Polish README.
- Prepare 3 demo commands.

Day 28:

- Mock interview explanation.
- Prepare resume project description.
- Final review.

</details>

## 9. Resume Project Description

```text
Implemented a TypeScript Agent Runtime with CLI/WebSocket dual entry points, streaming event protocol, multi-provider adapters, Tool Registry, RAG retrieval tool, session abort, and Fake Provider regression tests.
```

If the MCP adapter is completed, append:

```text
Additionally implemented an MCP Tool Adapter that normalizes external MCP tools into executable tools in the internal ToolRegistry.
```

## 10. Do Not Do Right Now

- Do not build a complex UI.
- Do not build a complete permission system.
- Do not build a complex planner.
- Do not build an enterprise-grade vector database.
- Do not integrate ten providers.
- Do not deep dive into complex TypeScript.
- Do not copy the full architecture of a large repository.

## 11. Weekly Review Questions

<details>
<summary>Expand weekly review questions</summary>

```text
What demonstrable capabilities did I complete this week?
Which layer boundary became clearer?
Which module can I still not explain clearly?
What is the most important deliverable next week?
What sentence can I add to my resume?
```

</details>
