import OpenAI from 'openai';
import type { CreateClient } from '../index';


type AI = ReturnType<CreateClient>;
type clientConfig = Parameters<CreateClient>[0];


export default class OpenAIAdaptor implements AI {
  private client: OpenAI;
  constructor(config: clientConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async *stream(requestConfig: Parameters<AI['chat']>[0]): ReturnType<AI['stream']> {

    try {
      const { data: stream } = await this.client.chat.completions.create({
        model: requestConfig.model,
        messages: requestConfig.messages,
        stream: true
      }).withResponse();


      yield { type: 'start', content: '', role: 'assistant' };

      for await (const thunk of stream) {
        const deltaText = thunk.choices[0]?.delta?.content;
        if (deltaText) {
          yield { type: 'text_delta', content: deltaText, role: 'assistant' };
        }
      }

      yield { type: 'end', content: '', role: 'assistant' };
    } catch (e) {
      const content = e instanceof Error ? e.message : String(e)
      yield { type: 'error', content, role: 'assistant' }
    }




  }

  async chat(requestConfig: Parameters<AI['chat']>[0]): ReturnType<AI['chat']> {
    const response = await this.client.chat.completions.create({
      model: requestConfig.model,
      messages: requestConfig.messages,
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
      role: response.choices[0].message.role,
      content: response.choices[0].message.content ?? '',
      tool_calls: (response.choices[0].message.tool_calls ?? []).map((tool) => {
        return {
          name: tool.function.name,
          args: JSON.parse(tool.function.arguments),
        };
      }),
    };
  }
}