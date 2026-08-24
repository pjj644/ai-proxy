import 'dotenv/config'
import https from 'https'
import http from 'http'
import { performance } from 'perf_hooks'
import OpenAI from 'openai'

interface LatencyMetric {
  dnsTimeMs: number
  tcpTimeMs: number
  tlsTimeMs: number
  ttftMs: number
  totalTimeMs: number
  outputTokens: number
  tokensPerSec: number
  content: string
}

const MIMO_API_KEY = process.env.MIMO_API_KEY || ''
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1'
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.5'

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

async function measureNetworkHandshake(targetUrl: string): Promise<{ dnsMs: number; tcpMs: number; tlsMs: number; totalHandshakeMs: number }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(targetUrl)
    const isHttps = urlObj.protocol === 'https:'
    const port = urlObj.port || (isHttps ? 443 : 80)

    const t0 = performance.now()
    let tDns = 0
    let tTcp = 0
    let tTls = 0

    const req = (isHttps ? https : http).request(
      {
        hostname: urlObj.hostname,
        port: port,
        path: urlObj.pathname || '/',
        method: 'HEAD',
        timeout: 8000,
      },
      (res) => {
        resolve({
          dnsMs: +(tDns - t0).toFixed(1),
          tcpMs: +(tTcp - (tDns || t0)).toFixed(1),
          tlsMs: isHttps ? +(tTls - tTcp).toFixed(1) : 0,
          totalHandshakeMs: +(performance.now() - t0).toFixed(1),
        })
      }
    )

    req.on('socket', (socket) => {
      socket.on('lookup', () => {
        tDns = performance.now()
      })
      socket.on('connect', () => {
        tTcp = performance.now()
      })
      socket.on('secureConnect', () => {
        tTls = performance.now()
      })
    })

    req.on('error', (err) => {
      resolve({
        dnsMs: +(tDns - t0).toFixed(1),
        tcpMs: +(tTcp - (tDns || t0)).toFixed(1),
        tlsMs: 0,
        totalHandshakeMs: +(performance.now() - t0).toFixed(1),
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Network handshake timeout'))
    })

    req.end()
  })
}

async function benchmarkStreaming(
  client: OpenAI,
  model: string,
  prompt: string,
  maxTokens: number = 512
): Promise<LatencyMetric> {
  const t0 = performance.now()
  let ttftMs = 0
  let fullContent = ''
  let firstChunkReceived = false

  const stream = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    max_tokens: maxTokens,
    temperature: 0.7,
  })

  for await (const chunk of stream) {
    if (!firstChunkReceived) {
      ttftMs = performance.now() - t0
      firstChunkReceived = true
    }
    const text = chunk.choices[0]?.delta?.content || ''
    fullContent += text
  }

  const totalTimeMs = performance.now() - t0
  // 简易按中英字符估算 token
  const outputTokens = Math.max(1, Math.round(fullContent.length * 0.85))
  const generationTimeSec = (totalTimeMs - ttftMs) / 1000
  const tokensPerSec = generationTimeSec > 0 ? +(outputTokens / generationTimeSec).toFixed(1) : 0

  return {
    dnsTimeMs: 0,
    tcpTimeMs: 0,
    tlsTimeMs: 0,
    ttftMs: +ttftMs.toFixed(1),
    totalTimeMs: +totalTimeMs.toFixed(1),
    outputTokens,
    tokensPerSec,
    content: fullContent.trim(),
  }
}

async function benchmarkTools(
  client: OpenAI,
  model: string,
  prompt: string
): Promise<{ ttftMs: number; totalTimeMs: number; toolCalled: string; args: string }> {
  const t0 = performance.now()
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'query_schedule',
          description: '查询日程或课程安排',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              keyword: { type: 'string', description: '搜索关键词' },
            },
            required: ['date'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_bus_schedule',
          description: '查询校车时刻表',
          parameters: {
            type: 'object',
            properties: {
              campus: { type: 'string', enum: ['Qingshuihe', 'Shahe'] },
            },
            required: ['campus'],
          },
        },
      },
    ],
    tool_choice: 'auto',
    temperature: 0.2,
  })

  const totalTimeMs = performance.now() - t0
  const choice = res.choices[0]
  const toolCall = choice.message.tool_calls?.[0]

  return {
    ttftMs: 0,
    totalTimeMs: +totalTimeMs.toFixed(1),
    toolCalled: toolCall?.function?.name || 'none',
    args: toolCall?.function?.arguments || '',
  }
}

async function main() {
  console.log('==================================================================')
  console.log('🔍 小米 MiMo-2.5 vs DeepSeek 延迟深度诊断与实测评测')
  console.log('==================================================================')
  console.log(`MiMo Endpoint: ${MIMO_BASE_URL} (${MIMO_MODEL})`)
  console.log(`DeepSeek Endpoint: ${DEEPSEEK_BASE_URL} (${DEEPSEEK_MODEL})`)
  console.log('------------------------------------------------------------------\n')

  // 1. 底层网络握手耗时测试
  console.log('【阶段 1】底层网络握手延迟（DNS + TCP + TLS）对比')
  try {
    const mimoNet = await measureNetworkHandshake(MIMO_BASE_URL)
    console.log(`👉 MiMo-2.5 握手: DNS=${mimoNet.dnsMs}ms, TCP=${mimoNet.tcpMs}ms, TLS=${mimoNet.tlsMs}ms | 总计: ${mimoNet.totalHandshakeMs}ms`)
  } catch (e: any) {
    console.warn(`👉 MiMo-2.5 握手失败: ${e.message}`)
  }

  try {
    const dsNet = await measureNetworkHandshake(DEEPSEEK_BASE_URL)
    console.log(`👉 DeepSeek 握手: DNS=${dsNet.dnsMs}ms, TCP=${dsNet.tcpMs}ms, TLS=${dsNet.tlsMs}ms | 总计: ${dsNet.totalHandshakeMs}ms`)
  } catch (e: any) {
    console.warn(`👉 DeepSeek 握手失败: ${e.message}`)
  }

  const mimoClient = new OpenAI({
    apiKey: MIMO_API_KEY,
    baseURL: MIMO_BASE_URL,
  })

  const dsClient = new OpenAI({
    apiKey: DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_BASE_URL,
  })

  // 2. 短文本流式响应与 TTFT (首字延迟) 多轮测试
  console.log('\n【阶段 2】短文本流式响应延迟测试（测试首字延迟 TTFT 及推理生成速度）')
  const shortPrompt = '请用一句话回答：什么是量子力学的叠加态？'

  console.log('\n--- 1. 小米 MiMo-2.5 (3轮测试) ---')
  for (let i = 1; i <= 3; i++) {
    try {
      const metric = await benchmarkStreaming(mimoClient, MIMO_MODEL, shortPrompt, 128)
      console.log(`  [Round ${i}] TTFT(首字耗时): ${metric.ttftMs}ms | 总耗时: ${metric.totalTimeMs}ms | 约 ${metric.outputTokens} tokens (${metric.tokensPerSec} tps)`)
      console.log(`           输出: "${metric.content.slice(0, 40)}..."`)
    } catch (e: any) {
      console.error(`  [Round ${i}] ❌ 失败: ${e.message}`)
    }
  }

  console.log('\n--- 2. DeepSeek (3轮测试对比) ---')
  for (let i = 1; i <= 3; i++) {
    try {
      const metric = await benchmarkStreaming(dsClient, DEEPSEEK_MODEL, shortPrompt, 128)
      console.log(`  [Round ${i}] TTFT(首字耗时): ${metric.ttftMs}ms | 总耗时: ${metric.totalTimeMs}ms | 约 ${metric.outputTokens} tokens (${metric.tokensPerSec} tps)`)
      console.log(`           输出: "${metric.content.slice(0, 40)}..."`)
    } catch (e: any) {
      console.error(`  [Round ${i}] ❌ 失败: ${e.message}`)
    }
  }

  // 3. 长上下文与复杂长文本生成
  console.log('\n【阶段 3】复杂长文本生成与推理速率对比')
  const longPrompt = '请列出计算机网络中TCP与UDP的5大核心区别，并逐条简述其应用场景。'

  console.log('\n--- 1. 小米 MiMo-2.5 长输出测试 ---')
  try {
    const metric = await benchmarkStreaming(mimoClient, MIMO_MODEL, longPrompt, 512)
    console.log(`👉 MiMo-2.5: TTFT=${metric.ttftMs}ms | 总耗时=${metric.totalTimeMs}ms | 输出约 ${metric.outputTokens} tokens | 速率=${metric.tokensPerSec} tokens/s`)
  } catch (e: any) {
    console.error(`👉 MiMo-2.5 长输出失败: ${e.message}`)
  }

  console.log('\n--- 2. DeepSeek 长输出测试 ---')
  try {
    const metric = await benchmarkStreaming(dsClient, DEEPSEEK_MODEL, longPrompt, 512)
    console.log(`👉 DeepSeek: TTFT=${metric.ttftMs}ms | 总耗时=${metric.totalTimeMs}ms | 输出约 ${metric.outputTokens} tokens | 速率=${metric.tokensPerSec} tokens/s`)
  } catch (e: any) {
    console.error(`👉 DeepSeek 长输出失败: ${e.message}`)
  }

  // 4. 工具调用 (Function Calling) 延迟测试
  console.log('\n【阶段 4】工具调用 (Tool Call) 响应延迟对比')
  const toolPrompt = '帮我查一下明天清水河校区去沙河校区的班车时刻表'

  console.log('--- 1. 小米 MiMo-2.5 工具调用 ---')
  try {
    const toolMetric = await benchmarkTools(mimoClient, MIMO_MODEL, toolPrompt)
    console.log(`👉 MiMo-2.5 工具决策耗时: ${toolMetric.totalTimeMs}ms | 命中工具: ${toolMetric.toolCalled} | 参数: ${toolMetric.args}`)
  } catch (e: any) {
    console.error(`👉 MiMo-2.5 工具调用失败: ${e.message}`)
  }

  console.log('--- 2. DeepSeek 工具调用 ---')
  try {
    const toolMetric = await benchmarkTools(dsClient, DEEPSEEK_MODEL, toolPrompt)
    console.log(`👉 DeepSeek 工具决策耗时: ${toolMetric.totalTimeMs}ms | 命中工具: ${toolMetric.toolCalled} | 参数: ${toolMetric.args}`)
  } catch (e: any) {
    console.error(`👉 DeepSeek 工具调用失败: ${e.message}`)
  }

  console.log('\n==================================================================')
  console.log('✅ 测试完成')
  console.log('==================================================================')
}

main().catch(console.error)
