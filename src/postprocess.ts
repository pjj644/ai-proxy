/**
 * 输出后处理与内容安全守卫
 */

/**
 * 清除模型可能输出的思维链标签（如 DeepSeek-R1 的 <think>...</think>）
 */
export function scrubThoughtTags(text: string): string {
  if (!text) return ''
  // 过滤包含在 <think> 与 </think> 之间的内容
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // 过滤未闭合的 <think> 标签开头
  cleaned = cleaned.replace(/<think>[\s\S]*/gi, '')
  return cleaned.trim()
}

/**
 * 对模型生成的 Tool Calls 进行安全与结构合法性校验
 */
export function validateAndSanitizeToolCalls(toolCalls: any[]): {
  validCalls: any[]
  hasError: boolean
  errorMsg?: string
} {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return { validCalls: [], hasError: false }
  }

  const validCalls: any[] = []
  for (const tc of toolCalls) {
    if (!tc || typeof tc.name !== 'string') {
      continue
    }

    let parsedArgs = tc.args
    if (typeof parsedArgs === 'string') {
      try {
        parsedArgs = JSON.parse(parsedArgs)
      } catch (err) {
        return {
          validCalls: [],
          hasError: true,
          errorMsg: `工具 ${tc.name} 的参数 JSON 格式损坏无法解析`,
        }
      }
    }

    validCalls.push({
      id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: tc.name,
      args: parsedArgs && typeof parsedArgs === 'object' ? parsedArgs : {},
    })
  }

  return { validCalls, hasError: false }
}

/**
 * 移动端 Markdown 智能换行与排版规范化（防止大模型将多个项目挤压在单行）
 */
export function formatMobileMarkdown(text: string): string {
  if (!text) return ''
  let formatted = text

  // 1. 在 📌 / 📚 / 🗓️ / 📅 等卡片 emoji 前如果不是换行，补充双换行
  formatted = formatted.replace(/([^\n])\s*(📌|📚|🗓️|📅)/gu, '$1\n\n$2')

  // 2. 在行内紧挨着的 "- 教师" / "- 教室" / "- 时间" 等项目符号前强制补充换行
  formatted = formatted.replace(
    /([^\n])\s*-\s*([^-\n]*?(?:教师|教室|地点|时间|节次|成绩|绩点|学分|周次|状态|倒计时|类型|标题|科目)[：:])/gu,
    '$1\n- $2',
  )

  // 3. 在卡片结束后的总结语句（如 "...(10:20-11:55)两节课都在上午..."）如果缺少换行，补充换行
  return formatted
}

export function maskSensitiveInfo(text: string): string {
  if (!text) return ''
  // 掩码 18 位身份证号码 (保留前6后4)
  let result = text.replace(/\b([1-9]\d{5})\d{8}(\w{4})\b/g, '$1********$2')
  // 掩码 11 位中国大陆手机号 (保留前3后4)
  result = result.replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, '$1****$2')
  return result
}


