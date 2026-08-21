/**
 * AI Agent 系统统一类型定义
 */

export interface ToolResultInput {
  tool_call_id: string
  success: boolean
  data: string
}

export interface ToolCallReq {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolCallWithMeta extends ToolCallReq {
  tool_call_id: string
  requiresConfirmation: boolean
  riskLevel: 'low' | 'medium' | 'high'
}

export interface TurnTelemetry {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  tool_call_count: number
  duration_ms: number
  ttft_ms: number
}

export interface CriticDecision {
  action: 'ACTION_CORRECT' | 'ACTION_CLARIFY' | 'ACTION_BAILOUT'
  reason: string
  repairedToolCall?: {
    name: string
    args: Record<string, unknown>
  }
  clarificationQuestion?: string
  bailoutMessage?: string
}

export interface PreprocessResult {
  cleanedMessage: string
  isQuickIntent: boolean
  quickReply?: string
  isInjected: boolean
  injectionReason?: string
  enrichedMessage: string
}
