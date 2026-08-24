import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import express, { Request, Response } from 'express'
import { fileURLToPath } from 'url'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { graph, ToolResultInput } from './graph'
import { getToolMeta } from './tools'
import { registry } from './registry'
import { parseScheduleFromImage } from './vision'
import { campusKnowledge } from './knowledge/store'
import { buildBusSchedulePayload, buildGuidesPayload } from './knowledge/api'
import { searchJwcWebsite } from './jwcScraper'
import { preprocessInput } from './preprocess'
import { scrubThoughtTags, maskSensitiveInfo } from './postprocess'
import type { ToolCallReq, ToolCallWithMeta, TurnTelemetry } from './types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { verifyRequestSecurity, rateLimiter, validatePayloadBoundaries } from './security'

const app = express()
app.use(express.json({ limit: '8mb' }))

const PORT: number = parseInt(process.env.PORT || '3000', 10)
const PROXY_AUTH_KEY: string = process.env.PROXY_AUTH_KEY || ''

// 会话并发互斥锁（防止同一个 session_id 并发触发图导致状态冲突）
const activeSessionLocks = new Set<string>()

// 简单的请求去重集合（60秒 TTL）
const recentRequestDeduplication = new Map<string, number>()

export function checkAuth(req: Request, res: Response): boolean {
  const key: string = (req.headers['x-proxy-key'] as string) || ''
  if (key !== PROXY_AUTH_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    activeSessions: activeSessionLocks.size,
  })
})

// ============ T5b 应用配置端点 ============

// 应用静态配置（学期锚点等），启动后首次访问读取并缓存
let cachedAppConfig: Record<string, unknown> | null = null
function loadAppConfig(): Record<string, unknown> {
  if (cachedAppConfig === null) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'config', 'appConfig.json'), 'utf-8')
      cachedAppConfig = JSON.parse(raw) as Record<string, unknown>
    } catch (e) {
      console.error('[config] failed to load appConfig.json:', e)
      cachedAppConfig = {}
    }
  }
  return cachedAppConfig
}

/**
 * GET /api/v1/config/app-config —— 下发学期开始日期、基准学期 ID 等应用级配置。
 * 响应形状：{ semesterStartDate, baseSemesterId, semesterLabel, generatedAt }。
 *
 * 鉴权决策：与既有业务 API（/api/knowledge/search 等）保持一致，采用
 * rateLimiter + verifyRequestSecurity（x-proxy-key 静态密钥或 HMAC-SHA256 签名双模式）。
 * 配置虽为非敏感只读数据，仍纳入统一鉴权以避免未授权抓取并与端侧既有请求头约定对齐。
 */
app.get('/api/v1/config/app-config', rateLimiter(60), verifyRequestSecurity, (_req: Request, res: Response) => {
  res.json({ ...loadAppConfig(), generatedAt: new Date().toISOString() })
})

// ============ T6b 知识库只读端点 ============

/**
 * GET /api/v1/knowledge/bus-schedule —— 校车时刻表（源：knowledge/data/bus_schedule.json）。
 * 响应字段与鸿蒙端 BusScheduleModel.ets 的 BusItem 接口对齐（映射逻辑见 knowledge/api.ts），
 * 附 generatedAt。鉴权策略与 app-config 相同（rateLimiter(60) + verifyRequestSecurity）。
 */
app.get('/api/v1/knowledge/bus-schedule', rateLimiter(60), verifyRequestSecurity, (_req: Request, res: Response) => {
  res.json(buildBusSchedulePayload())
})

/**
 * GET /api/v1/knowledge/guides —— 校园指南聚合（学术政策/场馆/校医院/校园生活）。
 * 可选查询参数 category（如 academic_policy/facilities/hospital/campus_life/all）与 keyword，
 * 过滤语义对齐前端 ToolExecutor.queryCampusGuide；输出条目为 GuideItem 形态，附 generatedAt。
 */
app.get('/api/v1/knowledge/guides', rateLimiter(60), verifyRequestSecurity, (req: Request, res: Response) => {
  const category = req.query.category ? String(req.query.category) : 'all'
  const keyword = req.query.keyword ? String(req.query.keyword) : ''
  res.json(buildGuidesPayload(category, keyword))
})

/**
 * 基础设施错误友好映射
 */
function mapErrorToUserFriendlyMessage(err: unknown): string {
  const msg = String((err as Error)?.message || err).toLowerCase()
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return 'AI 大脑当前较为繁忙（触发调用频控），请稍等数秒后再试。'
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('econnreset')) {
    return '与 AI 核心服务连接超时，请检查网络连接后重试。'
  }
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('api key')) {
    return 'AI 核心服务密钥配置异常，请联系管理员检查后端凭证。'
  }
  return '抱歉，服务暂时遇到了一点问题，请稍后重新发送。'
}

app.post('/api/chat', rateLimiter(30), verifyRequestSecurity, validatePayloadBoundaries, async (req: Request, res: Response) => {
  const { session_id, message, request_id, phone_context } = req.body || {}
  if (!session_id || !message) {
    res.status(400).json({ error: 'session_id and message are required' })
    return
  }

  const sessionId: string = String(session_id)
  const requestId: string = request_id ? String(request_id) : ''

  // 1. 请求级去重校验 (60s 防重)
  if (requestId) {
    const now = Date.now()
    const lastSeen = recentRequestDeduplication.get(requestId)
    if (lastSeen && now - lastSeen < 60000) {
      res.status(409).json({ error: 'Duplicate request detected, ignoring' })
      return
    }
    recentRequestDeduplication.set(requestId, now)
    // 定期清除过期 requestId
    if (recentRequestDeduplication.size > 500) {
      for (const [k, v] of recentRequestDeduplication.entries()) {
        if (now - v > 60000) recentRequestDeduplication.delete(k)
      }
    }
  }

  // 2. 会话并发互斥锁（排他保护）
  if (activeSessionLocks.has(sessionId)) {
    res.status(409).json({ error: '当前会话正在生成回复中，请稍候...' })
    return
  }
  activeSessionLocks.add(sessionId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = (obj: Record<string, unknown>): void => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`)
    } catch (e) {
      console.error('[chat] write error:', e)
    }
  }

  const startTime = Date.now()
  let ttftMs = 0
  let totalToolCallCount = 0
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  let clientClosed = false
  let finished = false

  res.on('close', () => {
    if (!finished) {
      clientClosed = true
      registry.cleanup(sessionId)
      console.log(`[chat] session=${sessionId} client disconnected mid-turn`)
    }
  })

  try {
    // 3. 输入预处理流水线 (Sanitization, Safety, Quick Intent, Context Enrichment)
    const preprocess = preprocessInput(message, phone_context)

    // 3.1 注入攻击检测拦截
    if (preprocess.isInjected) {
      send({ type: 'text_chunk', content: preprocess.injectionReason || '请求已被安全拦截。' })
      send({
        type: 'final',
        telemetry: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          tool_call_count: 0,
          duration_ms: Date.now() - startTime,
          ttft_ms: Date.now() - startTime,
        },
      })
      return
    }

    // 3.2 意图快筛短路（问候/闲聊 0 延迟直出，不 bindTools，不走复杂图）
    if (preprocess.isQuickIntent && preprocess.quickReply) {
      ttftMs = Date.now() - startTime
      send({ type: 'text_chunk', content: preprocess.quickReply })
      send({
        type: 'final',
        telemetry: {
          prompt_tokens: 15,
          completion_tokens: preprocess.quickReply.length,
          total_tokens: 15 + preprocess.quickReply.length,
          tool_call_count: 0,
          duration_ms: Date.now() - startTime,
          ttft_ms: ttftMs,
        },
      })
      return
    }

    // 4. 进入 LangGraph 调度循环
    send({ type: 'status', status: 'thinking', message: '正在理解您的问题与上下文...' })

    const config = { configurable: { thread_id: sessionId }, recursionLimit: 25 }
    let input: any = { messages: [new HumanMessage(preprocess.enrichedMessage)] }

    while (true) {
      const stream = await graph.stream(input, { ...config, streamMode: ['messages'] })
      for await (const chunk of stream) {
        let msgChunk: { _getType?: () => string; content?: unknown; response_metadata?: any; usage_metadata?: any; additional_kwargs?: any } | undefined
        if (Array.isArray(chunk)) {
          if (typeof chunk[0] === 'string') {
            const [mode, value] = chunk as [string, unknown]
            if (mode !== 'messages') continue
            msgChunk = (Array.isArray(value) ? value[0] : value) as typeof msgChunk
          } else {
            msgChunk = chunk[0] as typeof msgChunk
          }
        } else {
          msgChunk = chunk as typeof msgChunk
        }

        if (msgChunk && msgChunk._getType && msgChunk._getType() === 'ai') {
          // 提取模型思维链（如 MiMo-2.5 / DeepSeek Reasoner 的 reasoning_content）
          const reasoning =
            (msgChunk as any)?.additional_kwargs?.reasoning_content ||
            (msgChunk as any)?.response_metadata?.reasoning_content ||
            (msgChunk as any)?.delta?.reasoning_content ||
            ''
          if (typeof reasoning === 'string' && reasoning.length > 0) {
            send({ type: 'thought_chunk', content: reasoning })
          }

          const rawText = typeof msgChunk.content === 'string' ? msgChunk.content : ''
          const text = scrubThoughtTags(rawText)
          if (text.length > 0) {
            if (ttftMs === 0) {
              ttftMs = Date.now() - startTime
            }
            send({ type: 'text_chunk', content: maskSensitiveInfo(text) })
          }

          // 提取 Token 用量统计
          const usage = msgChunk.usage_metadata || msgChunk.response_metadata?.tokenUsage
          if (usage) {
            if (usage.input_tokens || usage.promptTokens) {
              promptTokens += Number(usage.input_tokens || usage.promptTokens)
            }
            if (usage.output_tokens || usage.completionTokens) {
              completionTokens += Number(usage.output_tokens || usage.completionTokens)
            }
            if (usage.total_tokens || usage.totalTokens) {
              totalTokens += Number(usage.total_tokens || usage.totalTokens)
            }
          }
        }
      }

      // 流结束，检查是否在中断点等待手机端回传工具结果
      const state = await graph.getState(config)
      const pendingTask = (state.tasks || []).find((t) => t.interrupts && t.interrupts.length > 0)
      if (!pendingTask) break // 到达 END 结束

      const interruptValue = pendingTask.interrupts![0].value as { toolCalls?: ToolCallReq[] }
      const toolCalls: ToolCallReq[] = (interruptValue?.toolCalls || []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
      }))
      totalToolCallCount += toolCalls.length

      const batch_id = `b-${Date.now()}`
      const toolCallsWithMeta: ToolCallWithMeta[] = toolCalls.map((tc) => {
        const meta = getToolMeta(tc.name, tc.args)
        return {
          tool_call_id: tc.id,
          id: tc.id,
          name: tc.name,
          args: tc.args,
          requiresConfirmation: meta.requiresConfirmation,
          riskLevel: meta.riskLevel,
        }
      })

      send({ type: 'status', status: 'tool_calling', message: '正在调用相关应用服务...' })
      send({ type: 'tool_call', batch_id, tool_calls: toolCallsWithMeta })
      console.log(
        `[chat] session=${sessionId} batch=${batch_id} tools=${toolCalls.map((t) => t.name).join(',')} -> waiting phone`,
      )

      // 计算阶梯超时时间并等待回传
      const timeoutMs = registry.calculateBatchTimeout(toolCalls)
      const results = await registry.register(sessionId, batch_id, timeoutMs)

      if (results === null) {
        // 超时或断开：生成自动恢复的降级错误结果，继续 resume 闭环
        const errResults: ToolResultInput[] = toolCalls.map((tc) => ({
          tool_call_id: tc.id,
          success: false,
          data: clientClosed ? '客户端已断开' : `端侧执行超时(${timeoutMs / 1000}s 未能返回)，已自动降级`,
        }))
        console.log(
          `[chat] session=${sessionId} batch=${batch_id} ${clientClosed ? 'client closed' : 'timeout'} -> auto-recovery resume`,
        )
        input = new Command({ resume: errResults })
      } else {
        console.log(`[chat] session=${sessionId} batch=${batch_id} got ${results.length} results -> resume`)
        input = new Command({ resume: results })
      }
      send({ type: 'status', status: 'thinking', message: '正在整合数据并生成回答...' })
    }

    if (clientClosed) {
      console.log(`[chat] session=${sessionId} client closed, finishing graph silently`)
    }

    // 发送 final 事件并透传遥测指标
    const finalTelemetry: TurnTelemetry = {
      prompt_tokens: promptTokens || 120,
      completion_tokens: completionTokens || 60,
      total_tokens: totalTokens || (promptTokens + completionTokens) || 180,
      tool_call_count: totalToolCallCount,
      duration_ms: Date.now() - startTime,
      ttft_ms: ttftMs || Date.now() - startTime,
    }

    console.log(
      `[chat] session=${sessionId} completed in ${finalTelemetry.duration_ms}ms (TTFT: ${finalTelemetry.ttft_ms}ms) | Tokens: [Prompt: ${finalTelemetry.prompt_tokens}, Completion: ${finalTelemetry.completion_tokens}, Total: ${finalTelemetry.total_tokens}] | Tools called: ${finalTelemetry.tool_call_count}`,
    )

    send({ type: 'final', telemetry: finalTelemetry })
  } catch (e: unknown) {
    console.error('[chat] error:', e)
    const friendlyMessage = mapErrorToUserFriendlyMessage(e)
    send({ type: 'error', message: friendlyMessage, raw_error: String((e as Error)?.message || e) })
  } finally {
    finished = true
    activeSessionLocks.delete(sessionId)
    try {
      res.end()
    } catch {}
  }
})

app.post('/api/tool-result', rateLimiter(60), verifyRequestSecurity, (req: Request, res: Response) => {
  const { session_id, batch_id, results } = req.body || {}
  if (!session_id || !batch_id || !Array.isArray(results)) {
    res.status(400).json({ error: 'session_id, batch_id and results[] are required' })
    return
  }
  const ok = registry.resolve(String(session_id), String(batch_id), results as ToolResultInput[])
  if (!ok) {
    res.status(409).json({ error: 'no pending tool call for this session/batch (expired or mismatched)' })
    return
  }
  res.status(202).json({ ok: true })
})

app.post('/api/vision/parse-schedule', rateLimiter(10), verifyRequestSecurity, async (req: Request, res: Response) => {
  const { image, hint } = req.body || {}
  if (!image) {
    res.status(400).json({ error: 'image base64 is required' })
    return
  }
  try {
    const result = await parseScheduleFromImage(String(image), hint ? String(hint) : undefined)
    res.json({ ok: true, data: result })
  } catch (error: unknown) {
    console.error('[vision/parse-schedule] error:', error)
    res.status(500).json({ ok: false, error: String((error as Error)?.message || error) })
  }
})

app.get('/api/knowledge/search', rateLimiter(60), verifyRequestSecurity, (req: Request, res: Response) => {
  const category = req.query.category ? String(req.query.category) : undefined
  const keyword = req.query.keyword ? String(req.query.keyword) : undefined
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 5
  const results = campusKnowledge.search({ category, keyword, limit })
  res.json({ ok: true, count: results.length, data: results })
})

app.get('/api/jwc/search', rateLimiter(30), verifyRequestSecurity, async (req: Request, res: Response) => {
  const keyword = req.query.keyword ? String(req.query.keyword) : undefined
  const category = req.query.category ? String(req.query.category) : 'all'
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 6
  try {
    const result = await searchJwcWebsite(keyword, category, limit)
    res.json(result)
  } catch (error: unknown) {
    res.status(500).json({ success: false, total: 0, notices: [], error: String((error as Error)?.message || error) })
  }
})

app.listen(PORT, () => {
  console.log(`[ai-agent] listening on port ${PORT}`)
})

export { app }
