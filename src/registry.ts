import type { ToolResultInput } from './graph'

interface PendingEntry {
  batch_id: string
  resolve: (results: ToolResultInput[] | null) => void
  timer: NodeJS.Timeout
}

/**
 * 挂起工具结果注册表。
 * /api/chat 在 graph 中断时 register 一个 promise 并 await；
 * /api/tool-result 到达时 resolve；超时/断开时返回 null（由调用方构造错误结果 resume，避免 graph 卡死）。
 * 按 session_id 索引（一个会话同一时间只可能挂起一批工具）。
 */
class PendingToolRegistry {
  private map: Map<string, PendingEntry> = new Map()

  register(sessionId: string, batchId: string, timeoutMs: number): Promise<ToolResultInput[] | null> {
    // 若该 session 已有挂起项（异常情况），先清掉旧的
    const old = this.map.get(sessionId)
    if (old) {
      clearTimeout(old.timer)
      old.resolve(null)
    }
    return new Promise<ToolResultInput[] | null>((resolve) => {
      const timer: NodeJS.Timeout = setTimeout(() => {
        if (this.map.delete(sessionId)) {
          resolve(null) // 超时
        }
      }, timeoutMs)
      this.map.set(sessionId, { batch_id: batchId, resolve, timer })
    })
  }

  resolve(sessionId: string, batchId: string, results: ToolResultInput[]): boolean {
    const entry = this.map.get(sessionId)
    if (!entry || entry.batch_id !== batchId) {
      return false // 无挂起项或 batch 不匹配（过期）
    }
    clearTimeout(entry.timer)
    this.map.delete(sessionId)
    entry.resolve(results)
    return true
  }

  cleanup(sessionId: string): void {
    const entry = this.map.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.map.delete(sessionId)
      entry.resolve(null) // 断开，信号 null
    }
  }
}

export const registry: PendingToolRegistry = new PendingToolRegistry()
