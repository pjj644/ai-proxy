import 'dotenv/config'
import assert from 'node:assert'
import { evaluateLoopState } from '../src/critic'

async function runCriticTest() {
  console.log('=== 测试 Critic Sub-Agent 裁决能力 ===')

  // 测试用例 1: 连续调用相同工具失败 -> Critic 应该诊断并给出裁决 (BAILOUT 或 CLARIFY 或 CORRECT)
  const decision = await evaluateLoopState({
    userQuery: '帮我查一下后天下午的课',
    executedStepsSummary:
      'AI 调用工具: app_data_query, args: {"domain":"course","filter":{"date":"2026-08-23"}}\n' +
      '工具返回: 错误: 找不到该日期的课表数据\n' +
      'AI 调用工具: app_data_query, args: {"domain":"course","filter":{"date":"2026-08-23"}}\n' +
      '工具返回: 错误: 找不到该日期的课表数据',
    lastError: '错误: 找不到该日期的课表数据',
  })

  console.log('Critic 裁决结果:', decision)
  assert.ok(['ACTION_CORRECT', 'ACTION_CLARIFY', 'ACTION_BAILOUT'].includes(decision.action))
  assert.ok(decision.reason && decision.reason.length > 0)
  console.log('✔ Critic Sub-Agent 成功产出合规结构化裁决！')
}

runCriticTest().catch((e) => {
  console.error('Critic test failed:', e)
  process.exit(1)
})
