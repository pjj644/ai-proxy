// 模拟手机端的联调脚本：POST /api/chat -> 解析 SSE -> 收到 tool_call 时回传假结果 -> 收最终回答。
// 用法: node test/phone-sim.mjs "帮我查一下今天李老师的课"
const BASE = 'http://localhost:3000'
const KEY = 'uestc-helper-proxy-key-change-me'

function mockData(name, args) {
  switch (name) {
    case 'app_data_query': {
      const domain = args?.domain
      if (domain === 'course') {
        return JSON.stringify({
          domain: 'course',
          count: 2,
          items: [
            { id: 'c1', name: '高等数学', teacher: '李老师', room: '品学楼A101', dayOfWeek: 3, section: '1-2节', timeRange: '08:30-10:05' },
            { id: 'c2', name: '离散数学', teacher: '李老师', room: '品学楼B202', dayOfWeek: 5, section: '3-4节', timeRange: '10:20-11:55' },
          ],
        })
      } else if (domain === 'exam') {
        return JSON.stringify({
          domain: 'exam',
          count: 1,
          items: [
            { courseName: '数据结构', examDate: '2026-08-25', examTimeRange: '14:30-16:30', examLocation: '品学楼C301', seatNo: '12', countdown: '5天' },
          ],
        })
      } else if (domain === 'grade') {
        return JSON.stringify({
          domain: 'grade',
          overallGPA: '3.82',
          totalCourses: 15,
          items: [
            { courseName: '高等数学', credit: 5, totalScore: '92', gradePoint: 4.0 },
            { courseName: '大学物理', credit: 4, totalScore: '85', gradePoint: 3.5 },
          ],
        })
      } else if (domain === 'system_info') {
        return JSON.stringify({
          date: '2026-08-20',
          time: '10:00',
          dayOfWeek: 4,
          dayOfWeekLabel: '周四',
          currentWeek: 1,
          totalWeeks: 20,
          semesterLabel: '2026-2027-1',
        })
      }
      return JSON.stringify({ domain, count: 0, items: [] })
    }
    case 'app_data_mutate':
      return JSON.stringify({
        success: true,
        message: `操作已成功执行: ${args?.action} ${args?.domain}`,
        eventId: 'evt-mock-123',
      })
    case 'app_control':
      return JSON.stringify({
        success: true,
        message: `应用控制指令已执行: ${args?.action}`,
        params: args?.params,
      })
    case 'campus_search':
      return JSON.stringify({
        query: args?.query,
        count: 1,
        results: [
          { title: '清水河至沙河校车时刻表', snippet: '清水河发车时间：07:00, 08:30, 11:30, 14:00, 17:30, 21:00...' },
        ],
      })
    case 'app_pipeline':
      return JSON.stringify({
        success: true,
        message: '流水线所有步骤已在端侧顺利执行完毕',
        stepResults: (args?.steps || []).map((s) => ({ stepId: s.stepId, success: true, result: 'OK' })),
      })
    case 'get_current_page_context':
      return JSON.stringify({
        pageName: 'grade',
        pageTitle: '成绩查询',
        summaryText: '当前学期GPA: 3.82，总学分: 35，已出成绩科目: 15门',
        dataSnapshot: { gpa: '3.82', totalCredits: 35, courseCount: 15 },
        availableActions: [{ actionId: 'import_grades', label: '从教务系统导入成绩', description: '打开教务成绩导入页面' }],
      })
    case 'execute_page_action':
      return JSON.stringify({
        action: args?.action,
        dispatched: true,
        message: `页面动作 [${args?.action}] 执行成功`,
      })
    // 兼容原有 mock
    case 'query_today_courses':
      return JSON.stringify({
        count: 2,
        courses: [
          { name: '高等数学', time: '第1-2节 (08:00-09:40)', room: '品学楼A101', teacher: '张老师' },
          { name: '大学英语', time: '第3-4节 (10:00-11:40)', room: '品学楼B203', teacher: '李老师' },
        ],
      })
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
const msg = process.argv[2] || '帮我查一下今天李老师的课'
console.log(`[phone-sim] session=${sessionId} msg="${msg}"`)
await chat(sessionId, msg)
