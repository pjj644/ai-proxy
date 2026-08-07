// 模拟手机端的联调脚本：POST /api/chat -> 解析 SSE -> 收到 tool_call 时回传假结果 -> 收最终回答。
// 用法: node test/phone-sim.mjs "我今天有几节课"
const BASE = 'http://localhost:3000'
const KEY = 'uestc-helper-proxy-key-change-me'

function mockData(name, args) {
  switch (name) {
    case 'query_today_courses':
      return JSON.stringify({
        count: 2,
        courses: [
          { name: '高等数学', time: '第1-2节 (08:00-09:40)', room: '品学楼A101', teacher: '张老师' },
          { name: '大学英语', time: '第3-4节 (10:00-11:40)', room: '品学楼B203', teacher: '李老师' },
        ],
      })
    case 'query_week_courses':
      return JSON.stringify({ week: 5, count: 10, schedule: { 周一: [{ name: '高等数学', time: '第1-2节', room: '品学楼A101' }] } })
    case 'query_current_week':
      return JSON.stringify({ currentWeek: 5, totalWeeks: 20 })
    case 'query_next_exam':
      return JSON.stringify({ courseName: '数据结构', examDate: '2026-08-15', examTimeRange: '14:00-16:00', examLocation: '品学楼C301', seatNo: '12', examType: '期末', countdown: '9天' })
    case 'query_gpa':
      return JSON.stringify({ overallGPA: '3.62', latestSemesterGPA: '3.81', latestSemesterId: 503, totalCourses: 28 })
    case 'check_login_status':
      return JSON.stringify({ isLoggedIn: true, email: 'test@uestc.edu.cn' })
    case 'has_course_data':
      return JSON.stringify({ hasCourseData: true })
    case 'navigate_to_page':
      return JSON.stringify({ message: '已导航', page: args?.page })
    default:
      return JSON.stringify({ mock: true, name, args, message: 'mock result (phone-sim)' })
  }
}

async function postToolResult(sessionId, batchId, toolCalls) {
  const results = toolCalls.map((tc) => ({
    tool_call_id: tc.tool_call_id,
    success: true,
    data: mockData(tc.name, tc.args),
  }))
  const r = await fetch(`${BASE}/api/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
    body: JSON.stringify({ session_id: sessionId, batch_id: batchId, results }),
  })
  if (!r.ok) console.error(`[tool-result] HTTP ${r.status}`)
}

async function chat(sessionId, message) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
    body: JSON.stringify({ session_id: sessionId, message }),
  })
  if (!res.ok || !res.body) {
    console.error('chat failed:', res.status, await res.text().catch(() => ''))
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let toolCount = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      for (const line of raw.split('\n')) {
        const s = line.trim()
        if (!s.startsWith('data:')) continue
        const evt = JSON.parse(s.slice(5).trim())
        if (evt.type === 'text_chunk') {
          fullText += evt.content
          process.stdout.write(evt.content)
        } else if (evt.type === 'tool_call') {
          toolCount += evt.tool_calls.length
          console.log(`\n[tool_call] batch=${evt.batch_id} tools=${evt.tool_calls.map((t) => t.name).join(',')}`)
          await postToolResult(sessionId, evt.batch_id, evt.tool_calls)
        } else if (evt.type === 'final') {
          console.log('\n[final]')
        } else if (evt.type === 'error') {
          console.log('\n[error]', evt.message)
        }
      }
    }
  }
  console.log(`\n---\n工具调用 ${toolCount} 次 | 耗时 ${Date.now() - t0}ms | 文本 ${fullText.length} 字`)
}

const sessionId = 'sim-' + Date.now()
const msg = process.argv[2] || '我今天有几节课'
console.log(`[phone-sim] session=${sessionId} msg="${msg}"`)
await chat(sessionId, msg)
