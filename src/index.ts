import 'dotenv/config'
import express, { Request, Response } from 'express'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { graph, ToolResultInput } from './graph'
import { getToolMeta } from './tools'

const app = express()
app.use(express.json({ limit: '8mb' }))

const PORT: number = parseInt(process.env.PORT || '3000', 10)
const PROXY_AUTH_KEY: string = process.env.PROXY_AUTH_KEY || ''

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

// ============ 阶段1：mock 执行器（自动回假数据，不接手机）============
function mockDataFor(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'query_today_courses':
      return JSON.stringify({
        count: 2,
        courses: [
          { name: '高等数学', time: '第1-2节 (08:00-09:40)', room: '品学楼A101', teacher: '张老师' },
          { name: '大学英语', time: '第3-4节 (10:00-11:40)', room: '品学楼B203', teacher: '李老师' },
        ],
      })
    case 'query_current_week':
      return JSON.stringify({ currentWeek: 5, totalWeeks: 20 })
    case 'query_next_exam':
      return JSON.stringify({
        courseName: '数据结构', examDate: '2026-08-15', examTimeRange: '14:00-16:00',
        examLocation: '品学楼C301', seatNo: '12', examType: '期末', countdown: '9天',
      })
    case 'query_gpa':
      return JSON.stringify({ overallGPA: '3.62', latestSemesterGPA: '3.81', latestSemesterId: 503, totalCourses: 28 })
    case 'check_login_status':
      return JSON.stringify({ isLoggedIn: true, email: 'test@uestc.edu.cn' })
    case 'has_course_data':
      return JSON.stringify({ hasCourseData: true })
    default:
      return JSON.stringify({ mock: true, name, args, message: 'mock result (phase 1)' })
  }
}

function mockExecute(tc: ToolCallReq): ToolResultInput {
  return { tool_call_id: tc.id, success: true, data: mockDataFor(tc.name, tc.args) }
}
// =====================================================================

app.post('/api/chat', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
  const { session_id, message } = req.body || {}
  if (!session_id || !message) {
    res.status(400).json({ error: 'session_id and message are required' })
    return
  }
  const config = { configurable: { thread_id: session_id as string }, recursionLimit: 25 }
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

  let input: any = { messages: [new HumanMessage(String(message))] }
  try {
    while (true) {
      const stream = await graph.stream(input, { ...config, streamMode: ['messages'] })
      for await (const chunk of stream) {
        // ['messages'] 模式下 chunk 形如 ['messages', [AIMessageChunk, metadata]]
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

      // 流结束后检查是否在中断点等待工具回传
      const state = await graph.getState(config)
      const pendingTask = (state.tasks || []).find((t) => t.interrupts && t.interrupts.length > 0)
      if (pendingTask) {
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
        console.log(`[chat] session=${session_id} batch=${batch_id} tools=${toolCalls.map((t) => t.name).join(',')} (mock)`)

        // 阶段1：mock 执行，自动回假数据后 resume
        const mockResults = toolCalls.map((tc) => mockExecute(tc))
        input = new Command({ resume: mockResults })
        continue
      }
      break // 到达 END
    }
    send({ type: 'final' })
  } catch (e: unknown) {
    console.error('[chat] error:', e)
    send({ type: 'error', message: String((e as Error)?.message || e) })
  } finally {
    res.end()
  }
})

app.post('/api/tool-result', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return
  res.status(501).json({ error: 'not implemented yet (phase 2) — phase 1 uses mock executor' })
})

app.listen(PORT, () => {
  console.log(`[ai-agent] listening on port ${PORT}`)
})

export { app }
