// 模拟手机端的联调脚本：POST /api/chat -> 解析 SSE -> 收到 tool_call 时回传假结果 -> 收最终回答。
//
// ============================ 基础用法（既有行为，完全保留） ============================
//   node test/phone-sim.mjs "帮我查一下今天李老师的课"
//
// ====================== 线级失败场景（--scenario 选择，增量加入） ======================
// 所有场景均在脚本内自建【本地一次性 mock SSE 服务器】注入故障，跑完即关：
// 不杀真实进程、不发起任何真实 LLM API 调用。详细说明见 test/phone-sim-scenarios.md。
//
//   node test/phone-sim.mjs --list                          # 列出全部场景
//   node test/phone-sim.mjs --scenario conn-refused         # (a) 连接拒绝（服务不可达）
//   node test/phone-sim.mjs --scenario first-byte-timeout   # (b) 首字节延迟超时（watchdog）
//          [--watchdog-ms 6000]            # 客户端首字节看门狗阈值（可缩短以快速触发）
//          [--first-byte-delay-ms 9000]    # mock 服务器推迟首个字节的时长
//   node test/phone-sim.mjs --scenario missing-final        # (c) 流正常结束但缺 final 帧
//   node test/phone-sim.mjs --scenario mid-stream-error     # (d) 流中途发出 error 帧
//   node test/phone-sim.mjs --scenario mid-stream-reset     # (e) 流中途连接重置/截断
//   node test/phone-sim.mjs --scenario tool-result-fail     # (f) tool-result 回传失败 -> 本地重试
//          [--tool-result-fail-times 1]    # /api/tool-result 前 N 次返回 500
//   通用可选: --base <url> --key <key> 覆盖目标后端（默认值与原脚本一致）；
//             场景命令末尾可直接追加对话消息。
//
// ========================= 预期前端行为规格（各场景代码处亦有对应注释） =========================
//   - 首事件前失败（拒连/首字节超时）-> 指数退避自动重试 2 次（1s 后第 1 次、3s 后第 2 次），仍失败才提示错误
//   - 已收内容后中断               -> 保留已收内容、标记中断态并提供「重新发送」
//   - 流干净结束但缺 final 帧       -> completed_with_warning 轻提示（内容照常展示，不进错误态）
//   - tool-result 回传失败          -> 本地重试 2 次（间隔 0.5s / 2s）
import http from 'node:http'
import net from 'node:net'

function parseArgs(argv) {
  const opts = {
    base: 'http://localhost:3000',
    key: 'uestc-helper-proxy-key-change-me',
    scenario: null,
    watchdogMs: 6000,
    firstByteDelayMs: 9000,
    toolResultFailTimes: 1,
    list: false,
    help: false,
    message: null,
  }
  const knownFlags = new Set([
    '--scenario', '--base', '--key', '--watchdog-ms', '--first-byte-delay-ms', '--tool-result-fail-times',
  ])
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') { opts.list = true; continue }
    if (a === '-h' || a === '--help') { opts.help = true; continue }
    if (knownFlags.has(a)) {
      const v = argv[++i]
      if (v === undefined) {
        console.error(`[phone-sim] 参数 ${a} 缺少取值`)
        printHelp()
        process.exit(1)
      }
      if (a === '--scenario') opts.scenario = v
      else if (a === '--base') opts.base = v
      else if (a === '--key') opts.key = v
      else if (a === '--watchdog-ms') opts.watchdogMs = Number(v)
      else if (a === '--first-byte-delay-ms') opts.firstByteDelayMs = Number(v)
      else if (a === '--tool-result-fail-times') opts.toolResultFailTimes = Number(v)
      continue
    }
    if (a.startsWith('-') && a !== '-') {
      console.error(`[phone-sim] 未知参数: ${a}`)
      printHelp()
      process.exit(1)
    }
    positional.push(a)
  }
  opts.message = positional.join(' ') || null
  return opts
}

function printHelp() {
  console.log('用法:')
  console.log('  node test/phone-sim.mjs [消息]                        # 既有默认链路')
  console.log('  node test/phone-sim.mjs --list                       # 列出全部失败场景')
  console.log('  node test/phone-sim.mjs --scenario <名称> [消息]      # 运行指定失败场景')
  console.log('')
  console.log('可用场景:')
  for (const [name, meta] of Object.entries(SCENARIOS)) {
    console.log(`  ${name.padEnd(18)} ${meta.title}`)
  }
  console.log('')
  console.log('可选参数:')
  console.log('  --base <url>                  目标后端地址（默认 http://localhost:3000）')
  console.log('  --key <key>                   X-Proxy-Key（默认同原脚本）')
  console.log('  --watchdog-ms <n>             场景(b)客户端首字节看门狗阈值，默认 6000')
  console.log('  --first-byte-delay-ms <n>     场景(b)mock 服务器首字节延迟，默认 9000')
  console.log('  --tool-result-fail-times <n>  场景(f)/api/tool-result 前 N 次返回 500，默认 1')
}

// ---------------------------------------------------------------------------
// 场景注册表：expect 为该场景在线上应当观察到的结果分类（用于自检退出码）。
// ---------------------------------------------------------------------------
const SCENARIOS = {
  'conn-refused': { title: '(a) 连接拒绝：目标端口无进程监听(ECONNREFUSED)', expect: 'pre_first_event_failure' },
  'first-byte-timeout': { title: '(b) 首字节延迟超时：连接建立但迟迟无首字节(watchdog)', expect: 'pre_first_event_failure' },
  'missing-final': { title: '(c) 流正常关闭(FIN)但缺少 final 事件帧', expect: 'completed_with_warning' },
  'mid-stream-error': { title: '(d) 流中途发出 error 帧后正常结束', expect: 'error_frame' },
  'mid-stream-reset': { title: '(e) 流中途 socket 销毁(RST/截断)，无 final 也无 error', expect: 'interrupted_after_content' },
  'tool-result-fail': { title: '(f) tool-result 回传前 N 次失败，验证本地重试(0.5s/2s)', expect: 'completed' },
}

// 观察结果分类 -> 对应的「预期前端行为」（依据前端容错规格）
const OUTCOME_NOTES = {
  pre_first_event_failure:
    '首事件前失败 -> 指数退避自动重试 2 次(1s 后第 1 次、3s 后第 2 次)，仍失败则给出网络异常提示，不得白屏/卡死。',
  interrupted_after_content:
    '已收内容后中断 -> 保留已收文本并标记中断态，提供「重新发送」入口。',
  completed_with_warning:
    '缺 final 的干净结束 -> completed_with_warning 轻提示（如“回答可能不完整”），内容正常展示，不进错误态。',
  error_frame:
    '收到 error 帧 -> 展示错误信息；此前已有部分内容，按“已收内容后中断”处理：保留内容、标记中断态并提供「重新发送」。',
  completed:
    '正常完成（收到 final 帧）。',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 注意：OPTS 解析必须放在 SCENARIOS 定义之后 —— parseArgs 的参数错误路径会调用
// printHelp()，而 printHelp 引用 SCENARIOS；过早解析会在该路径触发 TDZ ReferenceError。
const OPTS = parseArgs(process.argv.slice(2))
const BASE = OPTS.base
const KEY = OPTS.key

function freshStat() {
  return {
    events: 0,             // 收到的合法 SSE 事件数
    gotFinal: false,       // 是否收到 final 帧
    gotError: false,       // 是否收到 error 帧
    textLen: 0,            // 已收正文长度
    transportError: null,  // 连接/读取层错误(fetch 拒绝、ECONNRESET、watchdog abort 等)
    toolResultAttempts: 0, // tool-result 上报总尝试次数（含重试）
  }
}

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

async function postToolResult(sessionId, batchId, toolCalls, opts = {}) {
  const results = toolCalls.map((tc) => ({
    tool_call_id: tc.tool_call_id,
    success: true,
    data: mockData(tc.name, tc.args),
  }))
  const r = await fetch(`${opts.base || BASE}/api/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': opts.key || KEY },
    body: JSON.stringify({ session_id: sessionId, batch_id: batchId, results }),
  })
  if (!r.ok) console.error(`[tool-result] HTTP ${r.status}`)
  return r.ok
}

// 场景模式专用：tool-result 回传失败时按规格本地重试 2 次（0.5s / 2s）。
// 默认模式不经过此函数，保持原有“单次尝试、失败仅打印”的行为不变。
async function postToolResultWithRetry(sessionId, batchId, toolCalls, opts = {}) {
  const delays = [500, 2000] // 规格：tool-result 回传失败 -> 本地重试 2 次(0.5s/2s)
  const stat = opts.stat
  for (let attempt = 0; ; attempt++) {
    if (stat) stat.toolResultAttempts++
    let ok = false
    try {
      ok = await postToolResult(sessionId, batchId, toolCalls, opts)
    } catch (err) {
      console.error('[tool-result] 请求异常:', err?.cause?.code || err?.message || err)
    }
    if (ok) return true
    if (attempt >= delays.length) return false
    console.log(`[sim] tool-result 回传失败 -> ${delays[attempt]}ms 后本地重试(第 ${attempt + 1}/${delays.length} 次)`)
    await sleep(delays[attempt])
  }
}

async function chat(sessionId, message, opts = {}) {
  const t0 = Date.now()
  const stat = opts.stat || freshStat()
  // 首字节看门狗：仅当显式传入 firstByteWatchdogMs > 0 时启用（场景 b）。
  // 默认路径不启用定时器，行为与原脚本完全一致。
  // 注入点说明（规格 b）：延迟在 mock 服务器侧注入（--first-byte-delay-ms）；若真实链路
  // 无法在服务端注入延迟，可将 --watchdog-ms 调小以等效触发同一 watchdog 分支。
  const ac = new AbortController()
  let watchdog = null
  if (opts.firstByteWatchdogMs > 0) {
    watchdog = setTimeout(() => {
      console.log(`[sim] watchdog: ${opts.firstByteWatchdogMs}ms 内未收到任何响应字节，主动断开`)
      ac.abort()
    }, opts.firstByteWatchdogMs)
  }
  let res
  try {
    res = await fetch(`${opts.base || BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': opts.key || KEY },
      body: JSON.stringify({ session_id: sessionId, message }),
      signal: ac.signal,
    })
  } catch (err) {
    if (watchdog) clearTimeout(watchdog)
    stat.transportError = err
    return stat
  }
  if (!res.ok || !res.body) {
    console.error('chat failed:', res.status, await res.text().catch(() => ''))
    if (watchdog) clearTimeout(watchdog)
    stat.transportError = new Error(`HTTP ${res.status}`)
    return stat
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let toolCount = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (watchdog && (done || value)) { clearTimeout(watchdog); watchdog = null }
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        for (const line of raw.split('\n')) {
          const s = line.trim()
          if (!s.startsWith('data:')) continue
          // 原脚本此处 JSON.parse 无保护，残缺帧会让整脚本周退；
          // 现改为忽略非法帧（仅在异常线级数据如场景 e 下生效，正常链路行为不变）。
          let evt
          try { evt = JSON.parse(s.slice(5).trim()) } catch { continue }
          stat.events++
          if (evt.type === 'text_chunk') {
            fullText += evt.content
            process.stdout.write(evt.content)
          } else if (evt.type === 'tool_call') {
            toolCount += evt.tool_calls.length
            console.log(`\n[tool_call] batch=${evt.batch_id} tools=${evt.tool_calls.map((t) => t.name).join(',')}`)
            if (opts.retryToolResult) {
              // 场景(f)：回传失败 -> 本地重试 2 次(0.5s/2s)
              const ok = await postToolResultWithRetry(sessionId, evt.batch_id, evt.tool_calls, opts)
              if (!ok) console.error('[sim] tool-result 重试 2 次仍失败(规格: 放弃本轮，界面提供「重新发送」)')
            } else {
              await postToolResult(sessionId, evt.batch_id, evt.tool_calls)
            }
          } else if (evt.type === 'final') {
            stat.gotFinal = true
            console.log('\n[final]')
          } else if (evt.type === 'error') {
            stat.gotError = true
            console.log('\n[error]', evt.message)
          }
        }
      }
    }
  } catch (err) {
    // 流中途连接被重置/截断（场景 e）或 watchdog 中止等传输层错误
    stat.transportError = err
  } finally {
    if (watchdog) clearTimeout(watchdog)
  }
  buffer += decoder.decode() // 冲刷解码器残留字节（修复：原实现未 flush，UTF-8 尾部跨块时可能丢字）
  console.log(`\n---\n工具调用 ${toolCount} 次 | 耗时 ${Date.now() - t0}ms | 文本 ${fullText.length} 字`)
  stat.textLen = fullText.length
  return stat
}

// 把传输层事实归类为结果分类，供场景自检与预期前端行为对照
function classify(stat) {
  if (stat.events === 0 && stat.transportError) return 'pre_first_event_failure'
  if (stat.gotFinal) return 'completed'
  if (stat.gotError) return 'error_frame'
  if (stat.transportError) return 'interrupted_after_content'
  if (stat.events > 0) return 'completed_with_warning'
  return 'unknown'
}

function report(meta, stat, expect = meta.expect) {
  const kind = classify(stat)
  const detail = stat.transportError ? ` (${stat.transportError?.cause?.code || stat.transportError?.message || ''})` : ''
  console.log('\n==============================')
  console.log(`[sim] 观察结果: ${kind}${detail}`)
  console.log(
    `[sim] 统计: SSE事件=${stat.events} | final=${stat.gotFinal ? '有' : '无'} | error帧=${stat.gotError ? '有' : '无'}` +
      (stat.toolResultAttempts ? ` | tool-result尝试=${stat.toolResultAttempts}次` : ''),
  )
  console.log(`[sim] 对照规格 -> ${OUTCOME_NOTES[kind] ?? '未知结果分类'}`)
  if (kind === expect) {
    console.log(`[sim] 通过: 与场景预期一致(${expect})`)
  } else {
    console.log(`[sim] 不通过: 与场景预期(${expect})不一致 —— 请核对注入点或客户端容错实现`)
    process.exitCode = 1
  }
}

// ===========================================================================
// 本地 mock SSE 服务器：仅在 --scenario 模式下临时启动，脚本结束立即关闭。
// 帧格式与真实后端 src/index.ts 保持一致：
//   data: {"type":"text_chunk","content":"..."}
//   data: {"type":"tool_call","batch_id":"...","tool_calls":[{"tool_call_id":"..","name":"..","args":{}}]}
//   data: {"type":"final","telemetry":{}}   /   data: {"type":"error","message":".."}
// ===========================================================================
function sseOpen(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}
function sseSend(res, evt) {
  res.write(`data: ${JSON.stringify(evt)}\n\n`)
}
async function typeChunks(res, texts, gapMs = 60) {
  for (const t of texts) {
    sseSend(res, { type: 'text_chunk', content: t })
    await sleep(gapMs)
  }
}

async function handleMockRequest(req, res, scenario, opts, state) {
  const path = new URL(req.url, 'http://mock.local').pathname
  if (path === '/api/tool-result') {
    state.toolResultRequests++
    // ---- 场景(f)：前 N 次(默认 1)回传 tool-result 返回 500，模拟后端接收失败 ----
    // 预期前端行为：tool-result 回传失败 -> 客户端本地重试 2 次(0.5s/2s)；
    // 重试成功则本轮对话继续；三次均失败则放弃本轮并提供「重新发送」。
    if (state.toolResultRequests <= Math.max(0, opts.toolResultFailTimes | 0)) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '[mock] injected tool-result failure' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    state.resolveToolResult?.(true) // 放行 chat 流的后半段
    return
  }
  if (path !== '/api/chat') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  switch (scenario) {
    case 'first-byte-timeout': {
      // ---- 场景(b)：接受连接但推迟首个字节，直到 --first-byte-delay-ms 之后 ----
      // 预期前端行为：首字节超时发生在首个 SSE 事件之前，属“首事件前失败” ->
      // 指数退避自动重试 2 次(1s/3s)；全部失败后给出网络异常提示，不得白屏/卡死。
      // 注入点说明：若无法在服务端注入延迟，可改用 --watchdog-ms 缩短客户端看门狗阈值等效触发；
      // 反之将 --first-byte-delay-ms 设为小于 --watchdog-ms 的值，本场景即退化为一次成功流，
      // 可用于验证注入点自身是否生效。
      const timer = setTimeout(async () => {
        sseOpen(res)
        await typeChunks(res, ['这是首字节延迟放行后的正常回答。'])
        sseSend(res, { type: 'final', telemetry: {} })
        res.end()
      }, Math.max(0, opts.firstByteDelayMs))
      req.on('close', () => clearTimeout(timer)) // 客户端 watchdog abort 后及时清理，让 mock 能正常退出
      return
    }
    case 'missing-final': {
      // ---- 场景(c)：推若干 text_chunk 后直接 res.end()（TCP 正常 FIN），但没有 final 帧 ----
      // 预期前端行为：流干净结束但缺 final -> completed_with_warning 轻提示
      // （例如“回答可能不完整”），已收文本正常展示，不应进入错误态或卡死。
      sseOpen(res)
      await typeChunks(res, ['这是缺失 final 帧场景的部分', '回答内容，服务器随后正常关闭了连接。'])
      res.end()
      return
    }
    case 'mid-stream-error': {
      // ---- 场景(d)：先推正文，再发 error 帧，然后正常结束流 ----
      // 预期前端行为：收到 error 帧 -> 展示错误信息；因此前已收到部分内容，
      // 按“已收内容后中断”规格处理：保留内容、标记中断态并提供「重新发送」。
      sseOpen(res)
      await typeChunks(res, ['先输出一部分正常内容，'])
      sseSend(res, { type: 'error', message: '[mock] 上游模型调用失败(upstream error)' })
      res.end()
      return
    }
    case 'mid-stream-reset': {
      // ---- 场景(e)：推若干完整帧后，再塞半个残帧并直接销毁 socket(RST/截断) ----
      // 既无 final 也无 error 帧。残缺帧用于顺带检验客户端对非法 JSON 行的容错。
      // 预期前端行为：已收内容后连接异常中断 -> 标记中断态，保留已收内容，
      // 提供「重新发送」按钮；不得白屏、不得无限 loading。
      sseOpen(res)
      await typeChunks(res, ['这段回答会在', '中途被强制切断……'])
      res.write('data: {"type":"text_chun')
      setTimeout(() => {
        req.socket?.destroy()
        res.socket?.destroy()
      }, 50)
      return
    }
    case 'tool-result-fail': {
      // ---- 场景(f)：正常流中带一个 tool_call；等 /api/tool-result 成功后才续推后半段 ----
      // 预期前端行为：回传失败时本地重试 2 次(0.5s/2s)；重试成功则对话照常走到 final。
      sseOpen(res)
      await typeChunks(res, ['好的，我来帮你查询今天的课程。'])
      sseSend(res, {
        type: 'tool_call',
        batch_id: 'batch-mock-001',
        tool_calls: [
          { tool_call_id: 'call-mock-001', name: 'app_data_query', args: { domain: 'course' } },
        ],
      })
      const ok = await Promise.race([state.toolResultPromise, sleep(15000).then(() => false)])
      if (ok) {
        await typeChunks(res, ['今天李老师的课程有：高等数学(品学楼A101)、离散数学(品学楼B202)。'])
        sseSend(res, { type: 'final', telemetry: {} })
      } else {
        // 三次回传均失败的兜底分支（--tool-result-fail-times >= 3 时可达）
        sseSend(res, { type: 'error', message: '[mock] tool-result 多次回传失败' })
      }
      res.end()
      return
    }
    default:
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `unknown scenario: ${scenario}` }))
  }
}

function startMockServer(scenario, opts) {
  const state = { toolResultRequests: 0 }
  state.toolResultPromise = new Promise((resolve) => { state.resolveToolResult = resolve })
  const server = http.createServer((req, res) => handleMockRequest(req, res, scenario, opts, state))
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.()
            server.close(() => done())
          }),
      })
    })
  })
}

// 场景(a)：找一个“当前无人监听”的端口 —— 先临时绑定再释放，向它发起连接必然 ECONNREFUSED。
// 全程不接触真实后端进程，无需杀任何服务。
async function findClosedPort() {
  const srv = net.createServer()
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  await new Promise((resolve) => srv.close(resolve))
  srv.closeAllConnections?.()
  return port
}

async function runScenario(opts) {
  const meta = SCENARIOS[opts.scenario]
  if (!meta) {
    console.error(`[phone-sim] 未知场景 "${opts.scenario}"。可用场景: ${Object.keys(SCENARIOS).join(', ')}`)
    process.exitCode = 1
    return
  }
  const msg = opts.message || '帮我查一下今天李老师的课'
  const sessionId = 'sim-' + Date.now()
  console.log(`[phone-sim] 场景=${opts.scenario} | ${meta.title}`)
  console.log(`[phone-sim] session=${sessionId} msg="${msg}"`)
  console.log(`[sim] 对照规格: ${OUTCOME_NOTES[meta.expect]}`)
  console.log('------------------------------')

  let mock = null
  // 场景(f)特殊化：--tool-result-fail-times >= 3 时，规格预期变为“本地重试 2 次耗尽 -> 本轮失败(error 兜底)”
  const expectedKind =
    opts.scenario === 'tool-result-fail' && Math.max(0, opts.toolResultFailTimes | 0) >= 3
      ? 'error_frame'
      : meta.expect
  try {
    let base = opts.base
    if (opts.scenario === 'conn-refused') {
      base = `http://127.0.0.1:${await findClosedPort()}`
      console.log(`[sim] 目标 ${base} (无监听进程，预期 ECONNREFUSED)`)
    } else {
      mock = await startMockServer(opts.scenario, opts)
      base = mock.url
      console.log(`[sim] 本地 mock SSE 服务器: ${base}`)
    }

    if (opts.scenario === 'conn-refused' || opts.scenario === 'first-byte-timeout') {
      // 这两类属“首事件前失败”，脚本按规格演示指数退避自动重试 2 次(1s/3s)
      const backoffs = [1000, 3000]
      let stat = freshStat()
      for (let attempt = 0; ; attempt++) {
        stat = freshStat()
        await chat(sessionId, msg, {
          base,
          key: opts.key,
          stat,
          firstByteWatchdogMs: opts.scenario === 'first-byte-timeout' ? opts.watchdogMs : 0,
        })
        if (classify(stat) !== 'pre_first_event_failure' || attempt >= backoffs.length) break
        console.log(`\n[sim] 首事件前失败 -> ${backoffs[attempt]}ms 后自动重试(第 ${attempt + 1}/${backoffs.length} 次)\n`)
        await sleep(backoffs[attempt])
      }
      report(meta, stat, expectedKind)
    } else {
      const stat = freshStat()
      await chat(sessionId, msg, {
        base,
        key: opts.key,
        stat,
        retryToolResult: opts.scenario === 'tool-result-fail',
      })
      report(meta, stat, expectedKind)
    }
  } finally {
    if (mock) await mock.close()
  }
}

// ===========================================================================
// 入口分发
// ===========================================================================
if (OPTS.list || OPTS.help) {
  printHelp()
} else if (OPTS.scenario) {
  await runScenario(OPTS)
} else {
  // ---- 既有默认行为（保持不变）----
  const sessionId = 'sim-' + Date.now()
  const msg = OPTS.message || '帮我查一下今天李老师的课'
  console.log(`[phone-sim] session=${sessionId} msg="${msg}"`)
  await chat(sessionId, msg).catch((err) => {
    // 原脚本未捕获该异常会直接打印堆栈崩溃退出；现收敛为一行错误并保留非零退出码
    console.error('[phone-sim] 连接/读取失败:', err?.cause?.code || err?.message || err)
    process.exitCode = 1
  })
}
