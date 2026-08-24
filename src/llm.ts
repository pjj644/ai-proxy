import { ChatOpenAI } from '@langchain/openai'
import { StructuredTool } from '@langchain/core/tools'
import { Runnable } from '@langchain/core/runnables'

export interface LLMOptions {
  streaming?: boolean
  temperature?: number
  maxTokens?: number
  timeout?: number
  maxRetries?: number
}

/**
 * 实例化主模型（小米 MiMo-V2.5 优先，配置快速故障转移超时）
 */
function createPrimaryInstance(options: LLMOptions = {}): ChatOpenAI {
  const isMimoConfigured = Boolean(process.env.MIMO_API_KEY)

  if (isMimoConfigured) {
    return new ChatOpenAI({
      model: process.env.MIMO_MODEL || 'mimo-v2.5',
      apiKey: process.env.MIMO_API_KEY,
      configuration: {
        baseURL: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1',
      },
      streaming: options.streaming ?? true,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 2048,
      timeout: options.timeout ?? 8000, // 8s 超时自动降级
      maxRetries: options.maxRetries ?? 1, // 快速重试 1 次后降级
    })
  }

  // 若未配置 MIMO_API_KEY 则默认使用 DeepSeek
  return new ChatOpenAI({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    apiKey: process.env.DEEPSEEK_API_KEY,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    },
    streaming: options.streaming ?? true,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 2048,
  })
}

/**
 * 实例化降级备用模型（DeepSeek）
 */
function createFallbackInstance(options: LLMOptions = {}): ChatOpenAI | null {
  // 当配置了 MIMO_API_KEY 且配置了 DEEPSEEK_API_KEY 时，启用 DeepSeek 降级通道
  if (process.env.MIMO_API_KEY && process.env.DEEPSEEK_API_KEY) {
    return new ChatOpenAI({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
      apiKey: process.env.DEEPSEEK_API_KEY,
      configuration: {
        baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      },
      streaming: options.streaming ?? true,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 2048,
    })
  }
  return null
}

/**
 * 创建具备自动 Failover 降级的 LLM Runnable（主模型: MiMo-v2.5, 降级: DeepSeek）
 */
export function createLLM(options: LLMOptions = {}): Runnable {
  const primary = createPrimaryInstance(options)
  const fallback = createFallbackInstance(options)

  if (fallback) {
    return primary.withFallbacks({
      fallbacks: [fallback],
    })
  }
  return primary
}

/**
 * 创建带工具绑定的 LLM Runnable（主模型与降级模型均完整绑定工具，支持透明故障转移）
 */
export function createLLMWithTools(tools: StructuredTool[], options: LLMOptions = {}): Runnable {
  const primary = createPrimaryInstance(options).bindTools(tools)
  const fallbackInstance = createFallbackInstance(options)

  if (fallbackInstance) {
    const fallback = fallbackInstance.bindTools(tools)
    return primary.withFallbacks({
      fallbacks: [fallback],
    })
  }
  return primary
}
