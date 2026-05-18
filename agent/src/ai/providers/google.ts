import { GoogleGenAI } from '@google/genai';
import type {CreateClient} from '../index';


type AI = ReturnType<CreateClient>;
type clientConfig = Parameters<CreateClient>[0];


export default class GoogleGenAIAdaptor implements AI {
  private client: GoogleGenAI;
  constructor(config: clientConfig) {
    this.client = new GoogleGenAI({
      apiKey: config.apiKey,
    });
  }
  async chat(requestConfig: Parameters<AI['chat']>[0]): ReturnType<AI['chat']> {
    const response = await this.client.models.generateContent({
      model: requestConfig.model,
      contents: requestConfig.messages,
    });

    if (!response.candidates?.length) {
      return {
        message: {
          role: 'assistant',
          content: '',
        },
      };
    }

    return {
      message: {
        role: 'assistant',
        content: response.candidates?.[0].content?.parts?.[0].text || '',
      },
    };
  }
}
