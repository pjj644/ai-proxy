import { StateGraph, START, END, MessagesAnnotation, interrupt } from '@langchain/langgraph'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { AIMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages'
import { createLLM } from './llm'
import { tools } from './tools'
import { buildSystemPrompt } from './prompt'

const llm = createLLM()
const llmWithTools = llm.bindTools(tools)

export interface ToolResultInput {
  tool_call_id: string
  success: boolean
  data: string
}

/**
 * agent 节点：注入 system 提示词（依据最近一条 human 消息决定是否追加 APP_KNOWLEDGE），
 * 调用 DeepSeek（已 bindTools）。只返回 AI 消息，system 消息不写入 state。
 */
async function agentNode(state: typeof MessagesAnnotation.State): Promise<{ messages: BaseMessage[] }> {
  const msgs: BaseMessage[] = state.messages
  let lastHumanText = ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m._getType() === 'human') {
      lastHumanText = typeof m.content === 'string' ? m.content : ''
      break
    }
  }
  const sysMsg = new SystemMessage(buildSystemPrompt(lastHumanText))
  const response = await llmWithTools.invoke([sysMsg, ...msgs])
  return { messages: [response as BaseMessage] }
}

/**
 * tools 节点：把 LLM 想调的工具通过 interrupt 交给手机执行；
 * resume 时拿到结果数组，构造 ToolMessage 返回。
 * 一轮的多个 tool_calls 合并为一次中断/一次回传。
 */
async function toolsNode(state: typeof MessagesAnnotation.State): Promise<{ messages: BaseMessage[] }> {
  const last = state.messages[state.messages.length - 1] as AIMessage
  const toolCalls = last.tool_calls || []
  // interrupt 暂停；手机回传后 resume 值为 ToolResultInput[]
  const results = interrupt({ toolCalls }) as unknown as ToolResultInput[]
  const msgs: BaseMessage[] = results.map((r: ToolResultInput) =>
    new ToolMessage({
      tool_call_id: r.tool_call_id,
      content: r.success ? r.data : `错误: ${r.data}`,
    }),
  )
  return { messages: msgs }
}

function routeAfterAgent(state: typeof MessagesAnnotation.State): string {
  const last = state.messages[state.messages.length - 1] as AIMessage
  if (last && last.tool_calls && last.tool_calls.length > 0) return 'tools'
  return END
}

const checkpointer = SqliteSaver.fromConnString(
  process.env.CHECKPOINT_DB_PATH || './checkpoints.sqlite',
)

export const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, { tools: 'tools', [END]: END })
  .addEdge('tools', 'agent')
  .compile({ checkpointer })
