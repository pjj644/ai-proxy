// 断开测试：收到 tool_call 后立即 abort 连接、不回传结果。验证服务端 res.on('close') 检测并清理。
const BASE = 'http://localhost:3000'
const KEY = 'uestc-helper-proxy-key-change-me'

const ctrl = new AbortController()
const sessionId = 'sim-disc-' + Date.now()
const res = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
  body: JSON.stringify({ session_id: sessionId, message: '我今天有几节课' }),
  signal: ctrl.signal,
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
let aborted = false
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  if (buf.includes('"type":"tool_call"') && !aborted) {
    console.log('[disconnect-test] 收到 tool_call，立即 abort（不回传结果）')
    aborted = true
    ctrl.abort()
    break
  }
}
await new Promise((r) => setTimeout(r, 2000))
console.log(`[disconnect-test] session=${sessionId} 完成。服务端应已打印 "client disconnected mid-turn"`)
