import OpenAI from 'openai';
import type { clientConfig, AiProvider, AiRequestConfig } from '../index';



export default class OpenAIAdaptor implements AiProvider {
  private client: OpenAI;
  constructor(config: clientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async *stream(requestConfig: AiRequestConfig): ReturnType<AiProvider['stream']> {

    try {
      const { data: stream } = await this.client.chat.completions.create({
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
        stream: true
      }).withResponse();


      yield { type: 'start'};

      for await (const chunk of stream) {
        const deltaText = chunk.choices[0]?.delta?.content;
        if (deltaText) {
          yield { type: 'text_delta', content: deltaText};
        }
      }

      yield { type: 'end' };
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