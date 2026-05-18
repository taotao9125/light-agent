export type AgentEvent = 
  | StartEvent
  | TextDelta 
  | DoneEvent 
  | ErrorEvent 
  | ToolCallEvent
  | ToolResultEvent;

export type TextDelta = {
  // stream thunk update
  type: 'text_delta';
  content: string;
}

// stream thunk finished
export type DoneEvent = {
  type: 'end'
}

// stream thunk start
export type StartEvent = {
  type: 'start'
}

export type ErrorEvent = {
  type: 'error',
  message: string;
}

// ai request tool call
export type ToolCallEvent = {
  type: 'tool_call';
  id: string;
  name: string;
  args: unknown;
}

// after execute tool call
export type ToolResultEvent = {
  type: 'tool_result';
  id: string;
  name: string;
  content: unknown;
}

