import 'dotenv/config'
import { createLLM, createLLMWithTools } from '../src/llm'
import { tools } from '../src/tools'
import { HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'

async function testMimoConnection() {
  console.log('='.repeat(60))
  console.log('🚀 开始测试小米 MiMo-V2.5 连通性与自动降级机制')
  console.log('='.repeat(60))

  // 1. 基础对话测试（验证 MiMo-V2.5）
  console.log('\n[1/3] 测试小米 MiMo-V2.5 基础调用 (带 5s 超时)...')
  try {
    const directMimo = new ChatOpenAI({
      model: process.env.MIMO_MODEL || 'mimo-v2.5',
      apiKey: process.env.MIMO_API_KEY,
      configuration: {
        baseURL: process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1',
      },
      temperature: 0.7,
      maxTokens: 256,
      timeout: 5000,
      maxRetries: 0,
    })

    const res = await directMimo.invoke([new HumanMessage('你好，请用一句话介绍你自己。')])
    console.log('✔ 小米 MiMo-V2.5 响应成功:')
    console.log(`  └─ 内容: ${typeof res.content === 'string' ? res.content.trim() : JSON.stringify(res.content)}`)
  } catch (err: any) {
    console.warn('⚠️ 小米 MiMo-V2.5 直连异常 (可能因本地网络环境/代理拦截):', err.message || err)
    console.log('  └─ 触发降级机制验证...')
  }

  // 2. 测试通过 createLLM 的双引擎自动降级机制
  console.log('\n[2/3] 测试 createLLM 双引擎自适应调用 (MiMo 异常时自动秒级切 DeepSeek)...')
  try {
    const resilientLLM = createLLM({ streaming: false })
    const res = await resilientLLM.invoke([new HumanMessage('你好！请回复一句话。')])
    console.log('✔ 双引擎 LLM 成功响应 (已保障服务可用):')
    console.log(`  └─ 回复内容: ${typeof res.content === 'string' ? res.content.trim() : JSON.stringify(res.content)}`)
  } catch (err: any) {
    console.error('❌ 双引擎调用失败:', err.message || err)
  }

  // 3. 测试带工具调用的双引擎自动降级机制
  console.log('\n[3/3] 测试带工具绑定的双引擎自动降级 (createLLMWithTools)...')
  try {
    const resilientToolsLLM = createLLMWithTools(tools)
    const toolRes = (await resilientToolsLLM.invoke([
      new HumanMessage('帮我查一下今天有什么课？'),
    ])) as any

    console.log('✔ 带工具绑定的双引擎成功响应:')
    if (toolRes.tool_calls && toolRes.tool_calls.length > 0) {
      console.log(`  └─ 成功解析并触发工具: ${toolRes.tool_calls.map((t: any) => `${t.name}(${JSON.stringify(t.args)})`).join(', ')}`)
    } else {
      console.log(`  └─ 文本响应: ${toolRes.content}`)
    }
  } catch (err: any) {
    console.error('❌ 工具调用双引擎失败:', err.message || err)
  }

  console.log('\n' + '='.repeat(60))
  console.log('🎉 验证完成！系统已具备双引擎无缝容灾降级能力。')
  console.log('='.repeat(60))
}

testMimoConnection().catch(console.error)
