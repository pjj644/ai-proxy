import { ChatOpenAI } from '@langchain/openai'

export function createLLM(): ChatOpenAI {
  return new ChatOpenAI({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    },
    streaming: true,
    temperature: 0.7,
    maxTokens: 2048,
  })
}
