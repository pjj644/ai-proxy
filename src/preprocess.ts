import type { PreprocessResult } from './types'
import { campusKnowledge } from './knowledge/store'

const MAX_INPUT_LENGTH = 2000

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s+override/i,
  /你现在是\s*(DAN|开发者模式|无限制模式)/i,
  /忽略(你之前|上面|所有)的(提示词|指令|设定|约束)/i,
  /(输出|打印|泄漏|展示)\s*(系统提示词|system\s*prompt)/i,
]

const QUICK_GREETINGS: Record<string, string> = {
  '你好': '同学你好！我是成电校园助手 AI Agent。你可以随时向我查询课表、考试倒计时、成绩绩点、添加日程或检索校园指南，请问有什么可以帮你的？',
  '您好': '同学你好！我是成电校园助手 AI Agent，有什么课表、考试、成绩或校园日程我可以帮你的吗？',
  '在吗': '在的！成电校园助手随时为你待命，请问有什么需要协助的？',
  'hi': 'Hi！成电校园助手在此，请问今天有什么课程或考试安排需要查询吗？',
  'hello': 'Hello！我是成电校园助手，随时为你提供教务与日程支持。',
  '你是谁': '我是成电校园助手的内置 AI Agent，专为电子科技大学同学服务。我可以直接联动你的课表、考试、成绩、日程与校园生活指南，帮助你高效规划大学生活。',
  '你叫什么': '我是成电校园助手 AI Agent，你的成电随身数字化学习伴侣。',
  '谢谢': '不客气！随时乐意为你效劳，祝你在成电学习生活愉快！',
  '多谢': '不用谢！如果还有其他课程或日程安排需求，请随时告诉我。',
  '好的': '收到！如果还有其他问题或需要操作的事项，随时叫我。',
  'ok': '好的！随时为你待命。',
  '收到': '好的，祝你今天一切顺利！',
}

/**
 * 计算当前的系统时间与成电教学周锚点 (2026-2027 第一学期开学日: 2026-08-31)
 */
export function getCampusTimeAnchor(): {
  dateStr: string
  dayOfWeekStr: string
  weekNumber: number
} {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}-${day}`

  const daysOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const dayOfWeekStr = daysOfWeek[now.getDay()]

  // 以 2026-08-31 周一为第一周开端
  const semesterStart = new Date(2026, 7, 31).getTime() // 2026-08-31 (Month is 0-indexed)
  const diffDays = Math.floor((now.getTime() - semesterStart) / (1000 * 60 * 60 * 24))
  let weekNumber = Math.floor(diffDays / 7) + 1
  if (weekNumber < 1) weekNumber = 1
  if (weekNumber > 25) weekNumber = 20

  return { dateStr, dayOfWeekStr, weekNumber }
}

/**
 * 输入预处理主函数
 */
export function preprocessInput(
  rawMessage: unknown,
  phoneContext?: Record<string, unknown>,
): PreprocessResult {
  let cleaned = typeof rawMessage === 'string' ? rawMessage.trim() : ''

  // 1. 去除非打印控制字符（保留换行和制表符）
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

  // 2. 超长截断
  if (cleaned.length > MAX_INPUT_LENGTH) {
    cleaned = cleaned.slice(0, MAX_INPUT_LENGTH)
  }

  // 3. 安全防注入检测
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return {
        cleanedMessage: cleaned,
        isQuickIntent: false,
        isInjected: true,
        injectionReason: '检测到潜在的指令越狱或系统越权特征，请求已被安全拦截。',
        enrichedMessage: cleaned,
      }
    }
  }

  // 4. 意图快筛（纯问候/闲聊短路）
  const normalizedKey = cleaned.toLowerCase().replace(/[\s,.!?;:，。！？；：]/g, '')
  if (QUICK_GREETINGS[normalizedKey]) {
    return {
      cleanedMessage: cleaned,
      isQuickIntent: true,
      quickReply: QUICK_GREETINGS[normalizedKey],
      isInjected: false,
      enrichedMessage: cleaned,
    }
  }

  // 5. 动态时空与页面上下文丰富 (Context Enrichment)
  const { dateStr, dayOfWeekStr, weekNumber } = getCampusTimeAnchor()
  let contextPrefix = `[系统时空感知: 今天是 ${dateStr} ${dayOfWeekStr}, 当前为第 ${weekNumber} 教学周]`

  if (phoneContext && Object.keys(phoneContext).length > 0) {
    const page = phoneContext.currentPage ? `当前停留在【${phoneContext.currentPage}】页面` : ''
    const extra = phoneContext.selectedWeek ? `(选中查看第 ${phoneContext.selectedWeek} 周)` : ''
    if (page) {
      contextPrefix += ` [端侧上下文: ${page} ${extra}]`
    }
  }

  // 6. 校园服务与系统知识 RAG 增强 (Service Knowledge Enrichment)
  try {
    const serviceMatches = campusKnowledge.search({ keyword: cleaned, limit: 2 })
    if (serviceMatches && serviceMatches.length > 0) {
      const q = cleaned.toLowerCase()
      const relevant = serviceMatches.filter((item) => {
        const titleLower = item.title.toLowerCase()
        const tags = item.tags || []
        const isMentionedInQuery = titleLower.split('').some((c) => q.includes(c)) ||
          tags.some((t) => q.includes(t.toLowerCase())) ||
          q.includes('邮箱') || q.includes('门户') || q.includes('网站') || q.includes('链接') ||
          q.includes('网址') || q.includes('入口') || q.includes('怎么') || q.includes('哪里')
        return isMentionedInQuery
      })

      if (relevant.length > 0) {
        const hints = relevant
          .map((item) => {
            let h = `《${item.title}》`
            if (item.url) {
              h += `官方链接为 [${item.title}](${item.url})`
            }
            if (item.summary) {
              h += ` (${item.summary})`
            }
            return h
          })
          .join('；')
        contextPrefix += ` [校园知识库参考: ${hints}]`
      }
    }
  } catch (e) {
    console.error('[preprocess] RAG search error:', e)
  }

  const enriched = `${contextPrefix}\n${cleaned}`

  return {
    cleanedMessage: cleaned,
    isQuickIntent: false,
    isInjected: false,
    enrichedMessage: enriched,
  }
}
