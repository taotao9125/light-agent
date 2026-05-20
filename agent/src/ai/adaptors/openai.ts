import OpenAI from 'openai';
import type { clientConfig, AiProvider, AiRequestConfig } from '../index';




const pendingToolCalls = new Map<number, {
  id: string;
  name: string;
  args: string;
}>()

export default class OpenAIAdaptor implements AiProvider {
  private client: OpenAI;
  constructor(config: clientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      //  logLevel: 'debug',
    });
  }

  async *stream(requestConfig: AiRequestConfig): ReturnType<AiProvider['stream']> {

    const messages = requestConfig.messages.map(message => {
      const { role, content } = message;
      if (role === 'tool') {
        return {
          role,
          // from open ai sdk, tell it which tool I have called.
          tool_call_id: message.toolCallId,
          content: message.content
        }
      }

      // if (role === 'assistant' && message.toolCalls) {
      //   return {
      //     role,
      //     content: message.content,
      //     tool_calls: message.toolCalls.map(tool => ({
      //       id: tool.toolCallId,
      //       function: {
      //         arguments: typeof tool.args === 'object' ? JSON.stringify(tool.args) : tool.args,
      //         name: tool.name
      //       },
      //       type: 'function'
      //     }))
      //   }
      // }

      return { role, content };
    })

    try {
      const { data: stream } = await this.client.chat.completions.create({
        model: requestConfig.model,
        messages,
        // tell ai how many tools I have.
        tools: requestConfig.tools?.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.schema,
          },
          tool_choice: 'auto',
        })),
        stream: true,
        // 暂时
        //  reasoning: false,

      }).withResponse();


      yield { type: 'start' };

      for await (const chunk of stream) {

        const delta = chunk.choices[0]?.delta;
        // as any, deepseek 接口有 reasoning_content, 但 openai ts 类型没有
        const reasoningContent = (delta as any).reasoning_content
        const deltaText = delta?.content;

        if (reasoningContent) {
          yield {type: 'reasoning', content: reasoningContent}
        }

        if (deltaText) {
          yield { type: 'text_delta', content: deltaText };
        }


        for (const tool of delta?.tool_calls ?? []) {
          let current = pendingToolCalls.get(tool.index) || {
            id: '',
            name: '',
            args: ''
          };

          if (tool.id) {
            current.id = tool.id;
          }

          if (tool.function?.name) {
            current.name = tool.function?.name ?? '';
          }

          if (tool.function?.arguments) {
            current.args += tool.function?.arguments ?? '';
          }


          pendingToolCalls.set(tool.index, current);
        }

        if (chunk.choices[0].finish_reason === 'tool_calls') {
          for (const call of pendingToolCalls.values()) {
            yield {
              type: 'tool_call',
              id: call.id,
              name: call.name,
              args: call.args ? JSON.parse(call.args) : {},
            };
          }
          pendingToolCalls.clear();
        }



      }

      yield { type: 'done' };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      yield { type: 'error', message }
    }

  }


  async chat(requestConfig: AiRequestConfig): ReturnType<AiProvider['chat']> {
    const response = await this.client.chat.completions.create({
      model: requestConfig.model,
      messages: requestConfig.messages.map(message => {
        const { role, content } = message;

        if (role === 'tool') {
          return {
            role,
            // from open ai sdk, tell it which tool I have called.
            tool_call_id: message.toolCallId,
            content: message.content
          }
        }

        return { role, content };

      }),
      // tell ai how many tools I have.
      tools: requestConfig.tools?.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.schema,
        },
        tool_choice: 'auto',
      })),
    });

    return {
      role: 'assistant',
      content: response.choices[0].message.content ?? '',
      toolCalls: (response.choices[0].message.tool_calls ?? []).map((tool) => {
        if (tool.type !== 'function') return null;
        return {
          toolCallId: tool.id,
          name: tool.function.name,
          args: JSON.parse(tool.function.arguments),
        };
      }).filter(tool => !!tool)
    };
  }
}