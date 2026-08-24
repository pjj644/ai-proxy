import type { ToolResultInput } from './types'

interface PendingEntry {
  batch_id: string
  resolve: (results: ToolResultInput[] | null) => void
  timer: NodeJS.Timeout
}

interface CacheEntry {
  result: ToolResultInput
  expiresAt: number
}

const READ_ONLY_TOOLS = new Set([
  'app_data_query',
  'campus_search',
  'get_current_page_context',
  'query_today_courses',
  'query_week_courses',
  'query_current_week',
  'query_next_exam',
  'query_all_exams',
  'query_grades',
  'query_gpa',
  'query_schedule',
  'query_reminder_settings',
  'system_info',
])

/**
 * 挂起工具结果注册表与只读缓存管理
 */
class PendingToolRegistry {
  private pendingMap: Map<string, PendingEntry> = new Map()
  private cacheMap: Map<string, CacheEntry> = new Map()

  /**
   * 根据工具类型计算阶梯超时时间（毫秒）
   */
  calculateBatchTimeout(toolCalls: { name: string }[]): number {
    let maxTimeout = 10000 // 默认只读查询 10s
    for (const tc of toolCalls) {
      if (tc.name === 'app_pipeline' || tc.name === 'app_data_mutate' || tc.name === 'app_control') {
        maxTimeout = Math.max(maxTimeout, 30000) // 变更或流水线 30s
      } else if (tc.name === 'campus_search' || tc.name === 'generate_study_plan') {
        maxTimeout = Math.max(maxTimeout, 15000) // 搜索或算法处理 15s
      } else {
        maxTimeout = Math.max(maxTimeout, 10000) // 本地数据查询 10s
      }
    }
    return maxTimeout
  }

  /**
   * 注册等待工具回传
   */
  register(sessionId: string, batchId: string, timeoutMs: number): Promise<ToolResultInput[] | null> {
    const old = this.pendingMap.get(sessionId)
    if (old) {
      clearTimeout(old.timer)
      old.resolve(null)
    }
    return new Promise<ToolResultInput[] | null>((resolve) => {
      const timer: NodeJS.Timeout = setTimeout(() => {
        if (this.pendingMap.delete(sessionId)) {
          console.warn(`[PendingRegistry] session=${sessionId} batch=${batchId} timeout after ${timeoutMs}ms`)
          resolve(null) // 超时
        }
      }, timeoutMs)
      this.pendingMap.set(sessionId, { batch_id: batchId, resolve, timer })
    })
  }

  /**
   * 手机端回传解析
   */
  resolve(sessionId: string, batchId: string, results: ToolResultInput[]): boolean {
    const entry = this.pendingMap.get(sessionId)
    if (!entry || entry.batch_id !== batchId) {
      return false
    }
    clearTimeout(entry.timer)
    this.pendingMap.delete(sessionId)
    entry.resolve(results)
    return true
  }

  /**
   * 客户端断开连接清理
   */
  cleanup(sessionId: string): void {
    const entry = this.pendingMap.get(sessionId)
    if (entry) {
      clearTimeout(entry.timer)
      this.pendingMap.delete(sessionId)
      entry.resolve(null)
    }
  }

  /**
   * 生成工具调用缓存 Key
   */
  private generateCacheKey(toolName: string, args: Record<string, unknown>): string {
    const sortedKeys = Object.keys(args || {}).sort()
    const sortedArgs: Record<string, unknown> = {}
    for (const k of sortedKeys) {
      sortedArgs[k] = args[k]
    }
    return `${toolName}:${JSON.stringify(sortedArgs)}`
  }

  /**
   * 查询只读工具缓存（TTL 默认 30 秒）
   */
  getToolCache(toolName: string, args: Record<string, unknown>): ToolResultInput | null {
    if (!READ_ONLY_TOOLS.has(toolName)) {
      return null
    }
    const key = this.generateCacheKey(toolName, args)
    const entry = this.cacheMap.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cacheMap.delete(key)
      return null
    }
    return entry.result
  }

  /**
   * 写入只读工具缓存
   */
  setToolCache(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolResultInput,
    ttlMs: number = 30000,
  ): void {
    if (!READ_ONLY_TOOLS.has(toolName) || !result.success) {
      return
    }
    const key = this.generateCacheKey(toolName, args)
    this.cacheMap.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    })

    // 定期简单清理过期缓存（防止无界增长）
    if (this.cacheMap.size > 200) {
      const now = Date.now()
      for (const [k, v] of this.cacheMap.entries()) {
        if (now > v.expiresAt) {
          this.cacheMap.delete(k)
        }
      }
    }
  }
}

export const registry: PendingToolRegistry = new PendingToolRegistry()
