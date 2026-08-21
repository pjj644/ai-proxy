import assert from 'node:assert'

const BASE = 'http://localhost:3000'
const KEY = 'uestc-helper-proxy-key-change-me'

async function testConcurrencyLock() {
  console.log('=== 测试 Session 并发互斥锁 ===')
  const sessionId = 'mutex-test-' + Date.now()

  // 发起第一个长请求
  const req1 = fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
    body: JSON.stringify({ session_id: sessionId, message: '帮我查一下李老师的课' }),
  })

  // 稍等 100ms 立刻发起同 session 的并发请求
  await new Promise((r) => setTimeout(r, 100))

  const res2 = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': KEY },
    body: JSON.stringify({ session_id: sessionId, message: '在吗' }),
  })

  console.log(`并发第二个请求返回状态码: ${res2.status}`)
  assert.strictEqual(res2.status, 409)
  const body2 = await res2.json()
  console.log('并发第二个请求返回内容:', body2)
  assert.ok(body2.error.includes('正在生成回复中'))

  // 等待第一个请求结束并消费掉流
  const res1 = await req1
  if (res1.body) {
    const reader = res1.body.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  }

  console.log('✔ Session 并发互斥锁测试通过！成功拦截重入请求！')
}

testConcurrencyLock().catch((e) => {
  console.error(e)
  process.exit(1)
})
