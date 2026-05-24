# Agent Runtime Architecture

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
