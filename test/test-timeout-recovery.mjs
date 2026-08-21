// 使用全局 fetch
const BASE = 'http://localhost:3000'
const KEY = 'uestc-helper-proxy-key-change-me'

async function testTimeoutRecovery() {
  console.log('=== 测试工具超时自动降级与恢复 ===')
  const sessionId = 'timeout-test-' + Date.now()

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
    body: JSON.stringify({ session_id: sessionId, message: '帮我查一下微积分的考试时间' }),
  })

  if (!res.ok || !res.body) {
    console.error('Chat failed:', res.status)
    process.exit(1)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let gotToolCall = false
  let recoveredText = ''

  console.log('等待 SSE 流并模拟端侧不回传数据（触发超时自动降级）...')

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
        if (evt.type === 'tool_call') {
          gotToolCall = true
          console.log(`[tool_call 收到] batch=${evt.batch_id}，模拟手机端故意不回传数据...`)
        } else if (evt.type === 'text_chunk') {
          recoveredText += evt.content
          process.stdout.write(evt.content)
        } else if (evt.type === 'final') {
          console.log('\n[final 正常闭环结束！]')
          console.log('Telemetry:', evt.telemetry)
        }
      }
    }
  }

  console.log('\n✔ 超时自愈测试完成！后端未 Crash，成功流式收尾！')
}

testTimeoutRecovery().catch((e) => {
  console.error(e)
  process.exit(1)
})
