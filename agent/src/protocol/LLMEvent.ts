export type LLMEvent = 
  | LLMStartEvent
  | LLMTextDelta 
  | LLMDoneEvent 
  | LLMErrorEvent 
  | LLMToolCallEvent
  | LLMReasoning

// stream chunk start
export type LLMStartEvent = {
  type: 'start'
}


export type LLMTextDelta = {
  // stream chunk update
  type: 'text_delta';
  content: string;
}

export type LLMReasoning = {
  type: 'reasoning',
  content: string;
}


export type LLMErrorEvent = {
  type: 'error',
  message: string;
}


// stream chunk finished
export type LLMDoneEvent = {
  type: 'done'
}


// ai request tool call
export type LLMToolCallEvent = {
  type: 'tool_call';
  id: string;
  name: string;
  args: unknown;
}


