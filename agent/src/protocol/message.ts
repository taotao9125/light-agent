
export type Message = 
  | UserMessage 
  | AssistantMessage 
  | ToolMessage
  | SystemMessage
  


// input
export type UserMessage = {
  role: 'user';
  content: string;
}


// ai output
export type AssistantMessage = {
  role: 'assistant',
  content: string,
  toolCalls?: {
    // assistant response tool call id
    toolCallId: string;
     // assistant response tool call name (function name)
    name: string;
    // assistant response tool call arguments (function arguments)
    args: unknown
  }[];
}

// input
export type ToolMessage = {
  role: 'tool';
  // send ai  which tool I have called.
  toolCallId: string;
  // send ai the called tool(function) name
  name: string;
  // send ai the result of the called tool.
  content: string;
}

// input
export type SystemMessage = {
  role: 'system';
  content: string;
}