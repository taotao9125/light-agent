export type AgentEvent = 
  | AgentStartEvent
  | AgentTextDeltaEvent
  | AgentToolCallDoneEvent
  | AgentDoneEvent
  | AgentErrorEvent
  | AgentToolCallStart
  

export type AgentStartEvent = {
  type: 'agent_start';
}
export type AgentTextDeltaEvent = {
  type: 'agent_text_delta';
  content: string;
}


export type AgentToolCallStart = {
  type: 'agent_tool_call_start';
  id: string;
  name: string;
}

export type AgentToolCallDoneEvent = {
  type: 'agent_tool_call_done';
  id: string;
  name: string;
  content: unknown;
}

export type AgentToolCallErrorEvent = {
  type: 'agent_tool_call_error';
  id: string;
  name: string;
  message: string;
}

export type AgentDoneEvent = {
  type: 'agent_done'
}

export type AgentErrorEvent = {
  type: 'agent_error';
  message: string;
}