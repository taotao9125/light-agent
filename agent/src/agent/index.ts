import type { AiProvider } from '../ai/index';
import toolRegistry from '../tools/index';
import type { Message } from '../protocol/message';
import type { LLMToolCallEvent } from '../protocol/LLMEvent';

import { AgentEvent } from '../protocol/agentEvent';




type AgentConfig = {
  provider: AiProvider;
  model: string;
  toolRegistry: typeof toolRegistry;
}


type AgentEventListener = (event: AgentEvent) => void;

interface AgentInterface {
  prompt: (messge: Message[]) => void;
  on: (listener: AgentEventListener) => void;
}

class Agent implements AgentInterface {
  private provider: AiProvider;
  private toolRegistry: typeof toolRegistry;
  private messages: Message[];
  private model: string;
  private listeners: AgentEventListener[];
  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.toolRegistry = config.toolRegistry;
    this.messages = [];
    this.listeners = [];
    this.model = config.model;
  }

  emit(event: AgentEvent) {
    this.listeners.forEach(listener => listener(event))
  }

  async runAgentLoop() {

    this.emit({ type: 'agent_start' });

    while (true) {

      let thisTurnLLMAssistantMsg = '';
      let thisTurnLLMToolCalls: LLMToolCallEvent[] = [];

      const llmStream = this.provider.stream({
        model: this.model,
        messages: this.messages,
        tools: this.toolRegistry.list(),
      });


      for await (const chunk of llmStream) {
        if (chunk.type === 'text_delta') {
          this.emit({ type: 'agent_text_delta', content: chunk.content });
          thisTurnLLMAssistantMsg += chunk.content
        }


        if (chunk.type === 'tool_call') {
          thisTurnLLMToolCalls.push(chunk)
        }

      }

      // If there are no tool calls, stop loop
      if (!thisTurnLLMToolCalls.length) {
        this.emit({ type: 'agent_done' });
        return;
      }

       //   content: string | ChatCompletionContentPartText[];
    // role: "tool";
    // tool_call_id: string;

    
      this.messages.push({
        role: 'assistant',
        content: thisTurnLLMAssistantMsg,
        toolCalls: thisTurnLLMToolCalls.map(toolCall => ({
          toolCallId: toolCall.id,
          name: toolCall.name,
          args: toolCall.args
        }))
      });


      for (const toolCallRequest of thisTurnLLMToolCalls) {

        const { id, name, args } = toolCallRequest;

        this.emit({ type: 'agent_tool_call_start', id, name })

        const toolCommand = this.toolRegistry.get(toolCallRequest.name);
        if (!toolCommand) throw Error('unknown tool');


        // todo: cwd 必须来自外部
        const content = await toolCommand.execute(args, { cwd: process.cwd() })

        this.emit({ type: 'agent_tool_call_done', id, name, content });

        // 准备把 tool call 的结果发给 LLM，告诉它，我当前是tool消息，执行了什么 tool, id 是什么，结果是什么，它下一轮继续分析
        this.messages.push({
          role: 'tool',
          name,
          toolCallId: id,
          content
        })

      }


    }

  }


  prompt(message: Message[]) {
    for (const msg of message) {
      this.messages.push(msg)
    }

    this.runAgentLoop();
  }

  on(listener: AgentEventListener) {
    this.listeners.push(listener);
  }

}

export default Agent;