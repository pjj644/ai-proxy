import 'dotenv/config'
import { performance } from 'perf_hooks'
import OpenAI from 'openai'

const MIMO_API_KEY = process.env.MIMO_API_KEY || ''
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1'
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.5'

async function analyzeLatencyBreakdown() {
  const client = new OpenAI({ apiKey: MIMO_API_KEY, baseURL: MIMO_BASE_URL })

  console.log('='.repeat(70))
  console.log('🔬 小米 MiMo-2.5 延迟细分分析 (Reasoning vs Final Content)')
  console.log('='.repeat(70))

  const testPrompts = [
    '你好，请用一句话介绍你自己。',
    '今天星期几？',
    '帮我计算 345 * 123 是多少？',
  ]

  for (const prompt of testPrompts) {
    console.log(`\n👉 测试 Prompt: "${prompt}"`)
    const t0 = performance.now()
    let timeToFirstReasoningToken = 0
    let timeToFirstContentToken = 0
    let reasoningTokens = ''
    let contentTokens = ''
    let reasoningCount = 0
    let contentCount = 0

    const stream = await client.chat.completions.create({
      model: MIMO_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 512,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as any
      if (delta?.reasoning_content) {
        if (!timeToFirstReasoningToken) {
          timeToFirstReasoningToken = performance.now() - t0
        }
        reasoningTokens += delta.reasoning_content
        reasoningCount++
      }
      if (delta?.content) {
        if (!timeToFirstContentToken) {
          timeToFirstContentToken = performance.now() - t0
        }
        contentTokens += delta.content
        contentCount++
      }
    }
    const totalTime = performance.now() - t0

    console.log(`  ⏱️ 真实首包延迟 (TTFT - 首个思考 token): ${timeToFirstReasoningToken.toFixed(1)} ms`)
    console.log(`  ⏱️ 正文首字延迟 (TTFT - 首个正式回复 token): ${timeToFirstContentToken.toFixed(1)} ms`)
    console.log(`  ⏱️ 思考阶段耗时: ${(timeToFirstContentToken - timeToFirstReasoningToken).toFixed(1)} ms (生成 ${reasoningCount} 个思考 chunk)`)
    console.log(`  ⏱️ 正文生成耗时: ${(totalTime - timeToFirstContentToken).toFixed(1)} ms (生成 ${contentCount} 个内容 chunk)`)
    console.log(`  ⏱️ 总耗时: ${totalTime.toFixed(1)} ms`)
    console.log(`  🧠 思考过程片段: "${reasoningTokens.slice(0, 60).replace(/\n/g, ' ')}..."`)
    console.log(`  💬 最终回复内容: "${contentTokens.trim().slice(0, 60).replace(/\n/g, ' ')}..."`)
  }
}

analyzeLatencyBreakdown().catch(console.error)
