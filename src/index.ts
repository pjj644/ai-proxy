import 'dotenv/config'
import express, { Request, Response } from 'express'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { graph, ToolResultInput } from './graph'
import { getToolMeta } from './tools'
import { registry } from './registry'
import { parseScheduleFromImage } from './vision'
import { campusKnowledge } from './knowledge/store'

const app = express()
app.use(express.json({ limit: '8mb' }))

const PORT: number = parseInt(process.env.PORT || '3000', 10)
const PROXY_AUTH_KEY: string = process.env.PROXY_AUTH_KEY || ''
const TOOL_TIMEOUT_MS: number = parseInt(process.env.TOOL_TIMEOUT_MS || '30000', 10)

export function checkAuth(req: Request, res: Response): boolean {
  const key: string = (req.headers['x-proxy-key'] as string) || ''
  if (key !== PROXY_AUTH_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

interface ToolCallReq {
  id: string
  name: string
  args: Record<string, unknown>
}

app.post('/api/chat', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
  const { session_id, message } = req.body || {}
  if (!session_id || !message) {
    res.status(400).json({ error: 'session_id and message are required' })
    return
  }
  const sessionId: string = String(session_id)
  const config = { configurable: { thread_id: sessionId }, recursionLimit: 25 }
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

  // 客户端断开时清理挂起的工具结果（registry 返回 null -> 调用方用错误结果 resume）。
  // 注意：用 res.on('close') 而非 req.on('close')--后者在请求体读完后就会触发，不代表断开。
  let clientClosed = false
  let finished = false
  res.on('close', () => {
    if (!finished) {
      clientClosed = true
      registry.cleanup(sessionId)
      console.log(`[chat] session=${sessionId} client disconnected mid-turn`)
    }
  })

  let input: any = { messages: [new HumanMessage(String(message))] }
  try {
    while (true) {
      const stream = await graph.stream(input, { ...config, streamMode: ['messages'] })
      for await (const chunk of stream) {
        let msgChunk: { _getType?: () => string; content?: unknown } | undefined
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
          const text = typeof msgChunk.content === 'string' ? msgChunk.content : ''
          if (text.length > 0) send({ type: 'text_chunk', content: text })
        }
      }

      // 流结束，检查是否在中断点等待手机回传
      const state = await graph.getState(config)
      const pendingTask = (state.tasks || []).find((t) => t.interrupts && t.interrupts.length > 0)
      if (!pendingTask) break // 到达 END

      const interruptValue = pendingTask.interrupts![0].value as { toolCalls?: ToolCallReq[] }
      const toolCalls: ToolCallReq[] = (interruptValue?.toolCalls || []).map((tc) => ({
        id: tc.id, name: tc.name, args: tc.args,
      }))
      const batch_id = `b-${Date.now()}`
      const toolCallsWithMeta = toolCalls.map((tc) => {
        const meta = getToolMeta(tc.name)
        return {
          tool_call_id: tc.id, name: tc.name, args: tc.args,
          requiresConfirmation: meta.requiresConfirmation, riskLevel: meta.riskLevel,
        }
      })
      send({ type: 'tool_call', batch_id, tool_calls: toolCallsWithMeta })
      console.log(`[chat] session=${sessionId} batch=${batch_id} tools=${toolCalls.map((t) => t.name).join(',')} -> waiting phone`)

      // 等待手机回传；超时/断开返回 null
      const results = await registry.register(sessionId, batch_id, TOOL_TIMEOUT_MS)
      if (results === null) {
        // 超时或客户端断开：用错误结果 resume，避免 graph 卡死在检查点
        const errResults: ToolResultInput[] = toolCalls.map((tc) => ({
          tool_call_id: tc.id, success: false,
          data: clientClosed ? '客户端已断开' : '工具执行超时',
        }))
        console.log(`[chat] session=${sessionId} batch=${batch_id} ${clientClosed ? 'client closed' : 'timeout'} -> resume with error`)
        input = new Command({ resume: errResults })
      } else {
        console.log(`[chat] session=${sessionId} batch=${batch_id} got ${results.length} results -> resume`)
        input = new Command({ resume: results })
      }
      if (clientClosed) {
        // 客户端已断开：继续 resume 让 graph 收尾（写检查点），但不再发 SSE
        console.log(`[chat] session=${sessionId} client closed, finishing graph silently`)
      }
    }
    send({ type: 'final' })
  } catch (e: unknown) {
    console.error('[chat] error:', e)
    send({ type: 'error', message: String((e as Error)?.message || e) })
  } finally {
    finished = true
    try { res.end() } catch {}
  }
})

app.post('/api/tool-result', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
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

app.post('/api/vision/parse-schedule', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
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

app.get('/api/knowledge/search', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
  const category = req.query.category ? String(req.query.category) : undefined
  const keyword = req.query.keyword ? String(req.query.keyword) : undefined
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 5
  const results = campusKnowledge.search({ category, keyword, limit })
  res.json({ ok: true, count: results.length, data: results })
})

app.listen(PORT, () => {
  console.log(`[ai-agent] listening on port ${PORT}`)
})

export { app }

