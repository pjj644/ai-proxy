export interface ParsedScheduleFromVision {
  title: string
  date: string
  startTime: string
  endTime: string
  location?: string
  description?: string
  type?: 'custom' | 'assignment'
  confidence?: number
  rawAnalysis?: string
}

export async function parseScheduleFromImage(imageBase64: string, userHint?: string): Promise<ParsedScheduleFromVision> {
  const apiKey = process.env.ZHIPU_API_KEY || 'YOUR_ZHIPU_API_KEY'
  const baseURL = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
  const model = process.env.ZHIPU_VISION_MODEL || 'glm-4v-plus'

  // 格式化 Base64 图片 Data URL
  let dataUrl = imageBase64
  if (!imageBase64.startsWith('data:image/')) {
    dataUrl = `data:image/jpeg;base64,${imageBase64}`
  }

  const systemPrompt = `你是一个专业的大学校园海报、通知与活动截图日程解析助手。
你的任务是从用户上传的讲座海报、作业通知、学术会议截图或活动通知中，精准识别并提取出结构化的日程事件信息。
当前年份默认为 2026 年（若图片中未注明具体年份）。

你必须严格输出且仅输出一个纯 JSON 对象，格式如下：
{
  "title": "事件/讲座/活动标题",
  "date": "YYYY-MM-DD (例如 2026-09-15)",
  "startTime": "HH:mm (例如 14:30)",
  "endTime": "HH:mm (例如 16:30，若无明确结束时间，则默认按开始时间后2小时计算)",
  "location": "地点/教室/会议室/线上链接",
  "description": "主讲人、主题或重要备注",
  "type": "custom 或 assignment",
  "confidence": 0.95
}
请勿输出任何 Markdown 标记或多余文字，仅输出上述纯 JSON 字符串。`

  const messages: any[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userHint ? `用户附加说明：${userHint}\n请解析这张图片中的日程信息并返回纯 JSON。` : '请解析这张图片中的日程信息并返回纯 JSON。',
        },
        {
          type: 'image_url',
          image_url: {
            url: dataUrl,
          },
        },
      ],
    },
  ]

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.2,
      max_tokens: 1024,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`智谱 Vision API 调用失败 (${response.status}): ${errorText}`)
  }

  const result: any = await response.json()
  const rawContent = result.choices?.[0]?.message?.content || ''

  try {
    // 清理可能的 markdown 代码块标记
    let cleaned = rawContent.trim()
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.substring(7)
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.substring(3)
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3)
    }
    cleaned = cleaned.trim()

    const parsed = JSON.parse(cleaned) as ParsedScheduleFromVision
    parsed.rawAnalysis = rawContent
    return parsed
  } catch (e) {
    console.error('[Vision] JSON parse failed, raw content:', rawContent)
    return {
      title: '校园活动',
      date: new Date().toISOString().split('T')[0],
      startTime: '14:00',
      endTime: '16:00',
      description: rawContent,
      type: 'custom',
      rawAnalysis: rawContent,
    }
  }
}
