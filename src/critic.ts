import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { createLLM } from './llm'
import type { CriticDecision } from './types'

/**
 * 独立的 Critic Sub-Agent（审判/纠偏子代理）
 * 专职用于在主 Agent 遇到工具连续报错、疑似死循环或达到软熔断时，进行无污染局外诊断。
 */
export async function evaluateLoopState(params: {
  userQuery: string
  executedStepsSummary: string
  lastError?: string
}): Promise<CriticDecision> {
  const { userQuery, executedStepsSummary, lastError } = params

  const criticSystemPrompt = `你是一个高级 AI Agent 调度仲裁与纠错专家（Critic Sub-Agent）。
你的职责是审查主 Agent 在执行用户任务时的轨迹，识别其是否陷入死循环、幻觉报错或缺少关键信息，并做出最终仲裁。

你必须严格以 JSON 格式输出以下三类裁决之一：

1. ACTION_CORRECT（纠偏重试）：
   - 适用场景：主模型把工具参数传错了（如日期格式写错、参数字段缺失），且你有明确把握推断出正确的参数。
   - 结构：
     {
       "action": "ACTION_CORRECT",
       "reason": "纠错原因说明",
       "repairedToolCall": {
         "name": "工具名",
         "args": { "参数名": "正确的值" }
       }
     }

2. ACTION_CLARIFY（信息缺失反问）：
   - 适用场景：用户原始指令缺少核心信息（如没说具体时间/地点/哪门课），导致主 Agent 反复报错或无法继续。
   - 结构：
     {
       "action": "ACTION_CLARIFY",
       "reason": "缺少用户必要信息",
       "clarificationQuestion": "向用户反问的清晰话术"
     }

3. ACTION_BAILOUT（优雅兜底终止）：
   - 适用场景：所查询的数据确实不存在、权限不足、或经过多次尝试无法解决，必须立即终止循环向用户说明。
   - 结构：
     {
       "action": "ACTION_BAILOUT",
       "reason": "终止原因",
       "bailoutMessage": "向用户输出的得体解释与兜底建议（中文）"
     }

只输出纯 JSON 字符串，不要带 markdown 代码块标签（如 \`\`\`json ）。`

  const criticUserContent = `【用户原始请求】:
${userQuery}

【主 Agent 执行轨迹与最近工具调用记录】:
${executedStepsSummary}

【最近一次报错信息】:
${lastError || '无明确报错，但疑似陷入死循环或超限'}

请对当前状态做出裁决并输出 JSON：`

  try {
    const criticLLM = createLLM({ streaming: false })
    // 使用非流式调用
    const response = await criticLLM.invoke([
      new SystemMessage(criticSystemPrompt),
      new HumanMessage(criticUserContent),
    ])

    let rawText = typeof response.content === 'string' ? response.content.trim() : ''
    // 去除可能的 ```json 前后缀
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim()

    const parsed = JSON.parse(rawText) as CriticDecision
    if (['ACTION_CORRECT', 'ACTION_CLARIFY', 'ACTION_BAILOUT'].includes(parsed.action)) {
      return parsed
    }
    throw new Error(`Invalid critic action: ${parsed.action}`)
  } catch (err) {
    console.error('[CriticSubAgent] evaluation failed or parse error, fallback to BAILOUT:', err)
    return {
      action: 'ACTION_BAILOUT',
      reason: 'Critic Sub-Agent 执行异常，安全降级终止',
      bailoutMessage: '抱歉，在处理您的请求时遇到了多次尝试失败。请检查输入内容或稍后重试。',
    }
  }
}
