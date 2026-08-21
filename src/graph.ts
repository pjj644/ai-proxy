import { StateGraph, START, END, Annotation, interrupt } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { AIMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages'
import { createLLM } from './llm'
import { tools } from './tools'
import { buildSystemPrompt } from './prompt'
import { registry } from './registry'
import { evaluateLoopState } from './critic'
import { scrubThoughtTags, validateAndSanitizeToolCalls } from './postprocess'
import type { ToolResultInput, ToolCallReq } from './types'

export type { ToolResultInput }

const llm = createLLM()
const llmWithTools = llm.bindTools(tools)

/**
 * 状态图 Annotation 定义（支持迭代计数、循环哈希与连续错误追踪）
 */
export const GraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_curr, update) => update,
    default: () => 0,
  }),
  toolHashes: Annotation<string[]>({
    reducer: (curr, update) => curr.concat(update),
    default: () => [],
  }),
  consecutiveErrors: Annotation<number>({
    reducer: (_curr, update) => update,
    default: () => 0,
  }),
  softFused: Annotation<boolean>({
    reducer: (_curr, update) => update,
    default: () => false,
  }),
})

/**
 * 上下文裁剪与压缩：对超过 2 轮以上的历史超长 ToolMessage 内容进行剪枝
 */
function pruneHistoricalMessages(messages: BaseMessage[]): BaseMessage[] {
  if (messages.length <= 6) return messages

  const pruned: BaseMessage[] = []
  const cutoffIndex = messages.length - 4 // 最近 4 条消息保持完整

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (i < cutoffIndex && msg._getType() === 'tool') {
      const toolMsg = msg as ToolMessage
      const contentStr = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)
      if (contentStr.length > 800) {
        // 历史超长大结果进行摘要截断
        pruned.push(
          new ToolMessage({
            tool_call_id: toolMsg.tool_call_id,
            content: `${contentStr.slice(0, 300)}...[历史查询结果已精简截断，共${contentStr.length}字]`,
          }),
        )
        continue
      }
    }
    pruned.push(msg)
  }
  return pruned
}

/**
 * agent 节点：注入 system 提示词、执行消息压缩、调用大模型并处理输出
 */
async function agentNode(state: typeof GraphAnnotation.State): Promise<{
  messages: BaseMessage[]
  iterationCount: number
  softFused: boolean
}> {
  const rawMsgs = state.messages
  const prunedMsgs = pruneHistoricalMessages(rawMsgs)

  let lastHumanText = ''
  for (let i = prunedMsgs.length - 1; i >= 0; i--) {
    const m = prunedMsgs[i]
    if (m._getType() === 'human') {
      lastHumanText = typeof m.content === 'string' ? m.content : ''
      break
    }
  }

  let systemPromptText = buildSystemPrompt(lastHumanText)

  const currentIterations = state.iterationCount || 0
  const isSoftFused = currentIterations >= 4 || state.softFused

  if (isSoftFused) {
    systemPromptText +=
      '\n\n【系统强制熔断提醒】: 当前已进行了多次工具调用尝试。请立即根据现有已获取的所有信息整合总结并直接回答用户，严禁再调用任何工具！若数据缺失，请向用户坦诚说明。'
  }

  const sysMsg = new SystemMessage(systemPromptText)
  const response = await llmWithTools.invoke([sysMsg, ...prunedMsgs])

  // 后处理：清除思维链标签
  if (typeof response.content === 'string') {
    response.content = scrubThoughtTags(response.content)
  }

  return {
    messages: [response as BaseMessage],
    iterationCount: currentIterations + 1,
    softFused: isSoftFused,
  }
}

/**
 * tools 节点：处理只读缓存、向手机端发起中断与自动恢复
 */
async function toolsNode(state: typeof GraphAnnotation.State): Promise<{
  messages: BaseMessage[]
  toolHashes: string[]
  consecutiveErrors: number
}> {
  const last = state.messages[state.messages.length - 1] as AIMessage
  const rawToolCalls = last.tool_calls || []

  const { validCalls } = validateAndSanitizeToolCalls(rawToolCalls)
  if (validCalls.length === 0) {
    return {
      messages: [],
      toolHashes: [],
      consecutiveErrors: state.consecutiveErrors || 0,
    }
  }

  // 1. 检查只读工具缓存
  const cachedResults: ToolResultInput[] = []
  const callsNeedingExecution: ToolCallReq[] = []

  for (const tc of validCalls) {
    const cached = registry.getToolCache(tc.name, tc.args)
    if (cached) {
      console.log(`[toolsNode] hit cache for tool=${tc.name}`)
      cachedResults.push({ ...cached, tool_call_id: tc.id })
    } else {
      callsNeedingExecution.push(tc)
    }
  }

  let finalResults: ToolResultInput[] = [...cachedResults]

  // 2. 如果还有未命中缓存的工具，通过 interrupt 挂起等待手机端执行
  if (callsNeedingExecution.length > 0) {
    const executedResults = interrupt({ toolCalls: callsNeedingExecution }) as unknown as ToolResultInput[]
    if (Array.isArray(executedResults)) {
      for (const res of executedResults) {
        finalResults.push(res)
        // 若执行成功且是只读工具，写入缓存
        const matchedCall = callsNeedingExecution.find((c) => c.id === res.tool_call_id)
        if (matchedCall && res.success) {
          registry.setToolCache(matchedCall.name, matchedCall.args, res)
        }
      }
    }
  }

  const msgs: BaseMessage[] = finalResults.map((r: ToolResultInput) =>
    new ToolMessage({
      tool_call_id: r.tool_call_id,
      content: r.success ? r.data : `错误: ${r.data}`,
    }),
  )

  // 计算本轮工具调用哈希与失败统计
  const batchHash = validCalls
    .map((tc) => `${tc.name}:${JSON.stringify(tc.args)}`)
    .sort()
    .join('|')

  const hasFailure = finalResults.some((r) => !r.success)
  const nextConsecutiveErrors = hasFailure ? (state.consecutiveErrors || 0) + 1 : 0

  return {
    messages: msgs,
    toolHashes: [batchHash],
    consecutiveErrors: nextConsecutiveErrors,
  }
}

/**
 * Critic 裁决节点：在检测到循环或多次失败时唤醒局外子代理仲裁
 */
async function criticNode(state: typeof GraphAnnotation.State): Promise<{
  messages: BaseMessage[]
  consecutiveErrors: number
}> {
  const msgs = state.messages
  let userQuery = ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]._getType() === 'human') {
      userQuery = typeof msgs[i].content === 'string' ? (msgs[i].content as string) : ''
      break
    }
  }

  // 汇总最近工具执行轨迹
  const recentSteps: string[] = []
  let lastError = ''
  for (let i = Math.max(0, msgs.length - 6); i < msgs.length; i++) {
    const m = msgs[i]
    if (m._getType() === 'ai' && (m as AIMessage).tool_calls?.length) {
      recentSteps.push(`AI 调用工具: ${(m as AIMessage).tool_calls?.map((t) => t.name).join(', ')}`)
    } else if (m._getType() === 'tool') {
      const content = typeof m.content === 'string' ? m.content : ''
      recentSteps.push(`工具返回: ${content.slice(0, 150)}`)
      if (content.includes('错误:')) {
        lastError = content
      }
    }
  }

  console.log(`[criticNode] Triggering Critic Sub-Agent evaluation for userQuery="${userQuery.slice(0, 30)}..."`)
  const decision = await evaluateLoopState({
    userQuery,
    executedStepsSummary: recentSteps.join('\n'),
    lastError,
  })

  console.log(`[criticNode] Critic Sub-Agent decision: ${decision.action} (${decision.reason})`)

  if (decision.action === 'ACTION_CORRECT' && decision.repairedToolCall) {
    // 纠偏提示：注入一条系统修正引导
    const correctionMsg = new SystemMessage(
      `[Critic 子代理纠错建议]: 上一步工具参数可能有误。建议修正为使用工具 ${decision.repairedToolCall.name}，推荐参数: ${JSON.stringify(
        decision.repairedToolCall.args,
      )}。请依据该建议重新尝试。`,
    )
    return {
      messages: [correctionMsg],
      consecutiveErrors: 0,
    }
  } else if (decision.action === 'ACTION_CLARIFY' && decision.clarificationQuestion) {
    // 主动反问用户
    return {
      messages: [new AIMessage(decision.clarificationQuestion)],
      consecutiveErrors: 0,
    }
  } else {
    // 优雅兜底终止
    const finalReply =
      decision.bailoutMessage ||
      '抱歉，在尝试为您查询或执行该操作时遇到了持续异常。请稍后重试，或检查具体时间与关键词是否准确。'
    return {
      messages: [new AIMessage(finalReply)],
      consecutiveErrors: 0,
    }
  }
}

/**
 * 智能路由判断器：决定下一步是调用 tools、唤醒 critic 还是结束
 */
function routeAfterAgent(state: typeof GraphAnnotation.State): string {
  const last = state.messages[state.messages.length - 1] as AIMessage
  const toolCalls = last?.tool_calls || []

  // 无工具调用，直接结束
  if (!toolCalls || toolCalls.length === 0) {
    return END
  }

  // 1. 硬熔断检查（超过 6 次迭代强制进入 Critic 兜底）
  if ((state.iterationCount || 0) >= 6) {
    console.warn(`[routeAfterAgent] Hard fuse triggered (iterations >= 6) -> route to critic`)
    return 'critic'
  }

  // 2. 工具死循环比对 (Zero-Cost Hash Guard)
  const currentBatchHash = toolCalls
    .map((tc) => `${tc.name}:${JSON.stringify(tc.args)}`)
    .sort()
    .join('|')

  const hashes = state.toolHashes || []
  if (hashes.length >= 1 && hashes[hashes.length - 1] === currentBatchHash) {
    console.warn(`[routeAfterAgent] Identical tool call loop detected (${currentBatchHash}) -> route to critic`)
    return 'critic'
  }

  // 3. 连续报错检查（连续 2 次以上工具失败）
  if ((state.consecutiveErrors || 0) >= 2) {
    console.warn(`[routeAfterAgent] Consecutive tool errors (>= 2) -> route to critic`)
    return 'critic'
  }

  return 'tools'
}

function routeAfterCritic(state: typeof GraphAnnotation.State): string {
  const last = state.messages[state.messages.length - 1]
  // 若 Critic 输出了 SystemMessage（纠偏引导），则继续回 agent 尝试；若是 AIMessage 则直接结束
  if (last && last._getType() === 'system') {
    return 'agent'
  }
  return END
}

const checkpointer = SqliteSaver.fromConnString(
  process.env.CHECKPOINT_DB_PATH || './checkpoints.sqlite',
)

export const graph = new StateGraph(GraphAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addNode('critic', criticNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, {
    tools: 'tools',
    critic: 'critic',
    [END]: END,
  })
  .addEdge('tools', 'agent')
  .addConditionalEdges('critic', routeAfterCritic, {
    agent: 'agent',
    [END]: END,
  })
  .compile({ checkpointer })
