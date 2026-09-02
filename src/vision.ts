export type VisionMode = 'schedule' | 'course_table' | 'grade_report'

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

export interface ParsedCourseItem {
  name: string
  teacher?: string
  room?: string
  dayOfWeek: number // 1=周一 ... 7=周日
  startSection: number // 1..12
  duration: number // 持续节数 (1..4)
  validWeeks: string // 有效周次 (如 "1-16", "1-8", "1,3,5")
  confidence?: number
}

export interface ParsedCourseTableFromVision {
  courses: ParsedCourseItem[]
  semester?: string
  confidence?: number
  rawAnalysis?: string
}

export interface ParsedGradeItem {
  courseName: string
  courseCode?: string
  credit: number
  score: string
  gradePoint: number
  semester?: string
  courseCategory?: string
  confidence?: number
}

export interface ParsedGradeReportFromVision {
  grades: ParsedGradeItem[]
  gpa?: number
  totalCredits?: number
  confidence?: number
  rawAnalysis?: string
}

export type VisionResult = ParsedScheduleFromVision | ParsedCourseTableFromVision | ParsedGradeReportFromVision

export async function parseVisionFromImage(
  imageBase64: string,
  mode: VisionMode = 'schedule',
  userHint?: string,
): Promise<VisionResult> {
  const apiKey = process.env.ZHIPU_API_KEY || ''
  if (!apiKey) {
    throw new Error('[Vision] ZHIPU_API_KEY is not configured in environment variables')
  }
  const baseURL = process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
  const model = process.env.ZHIPU_VISION_MODEL || 'glm-4v-plus'

  // 格式化 Base64 图片 Data URL
  let dataUrl = imageBase64
  if (!imageBase64.startsWith('data:image/')) {
    dataUrl = `data:image/jpeg;base64,${imageBase64}`
  }

  let systemPrompt = ''
  if (mode === 'course_table') {
    systemPrompt = `你是一个专业的大学课表图片识别助手。
你的任务是从用户上传的课程表截图、教务课表拍照或第三方课表截图中，精准识别并提取出所有课程格子的结构化信息。
请仔细分析星期几（列）、节次（行）、课程名称、教师、教室和上课周次。
你必须严格输出且仅输出一个纯 JSON 对象，格式如下：
{
  "courses": [
    {
      "name": "高等数学",
      "teacher": "张老师",
      "room": "品学楼 A101",
      "dayOfWeek": 1,
      "startSection": 1,
      "duration": 2,
      "validWeeks": "1-16",
      "confidence": 0.95
    }
  ],
  "semester": "2026-2027学年第1学期",
  "confidence": 0.95
}
其中：
- dayOfWeek 取整数：1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六, 7=周日；
- startSection 为开始节次（1-12）；
- duration 为持续节数（通常为2节或3节）；
- validWeeks 尽量提取为范围如 "1-16", "1-8", "9-16", "1-16单", "1-16双" 等；
- 如无法确定字段请给合理默认值，不可留空数组。
请勿输出任何 Markdown 标记或多余解释文字，仅输出上述纯 JSON 字符串。`
  } else if (mode === 'grade_report') {
    systemPrompt = `你是一个专业的大学成绩单图片识别助手。
你的任务是从用户上传的成绩单截图、教务成绩列表拍照中，精准提取所有科目的成绩数据。
你必须严格输出且仅输出一个纯 JSON 对象，格式如下：
{
  "grades": [
    {
      "courseName": "微积分I",
      "courseCode": "MATH1001",
      "credit": 4.0,
      "score": "92",
      "gradePoint": 4.0,
      "semester": "2025-2026-1",
      "courseCategory": "必修",
      "confidence": 0.95
    }
  ],
  "gpa": 3.85,
  "totalCredits": 28.5,
  "confidence": 0.95
}
请勿输出任何 Markdown 标记或多余解释文字，仅输出上述纯 JSON 字符串。`
  } else {
    // 默认 schedule 模式
    systemPrompt = `你是一个专业的大学校园海报、通知与活动截图日程解析助手。
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
  }

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
          text: userHint ? `用户附加说明：${userHint}\n请解析这张图片并返回纯 JSON。` : '请解析这张图片并返回纯 JSON。',
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
      temperature: 0.1,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`智谱 Vision API 调用失败 (${response.status}): ${errorText}`)
  }

  const result: any = await response.json()
  const rawContent = result.choices?.[0]?.message?.content || ''

  try {
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

    const parsed = JSON.parse(cleaned) as VisionResult
    parsed.rawAnalysis = rawContent
    return parsed
  } catch (e) {
    console.error(`[Vision] JSON parse failed (${mode}), raw content:`, rawContent)
    if (mode === 'course_table') {
      return {
        courses: [],
        confidence: 0,
        rawAnalysis: rawContent,
      } as ParsedCourseTableFromVision
    } else if (mode === 'grade_report') {
      return {
        grades: [],
        confidence: 0,
        rawAnalysis: rawContent,
      } as ParsedGradeReportFromVision
    }
    return {
      title: '校园活动',
      date: new Date().toISOString().split('T')[0],
      startTime: '14:00',
      endTime: '16:00',
      description: rawContent,
      type: 'custom',
      confidence: 0.5,
      rawAnalysis: rawContent,
    } as ParsedScheduleFromVision
  }
}

/** 兼容旧版调用的包装函数 */
export async function parseScheduleFromImage(
  imageBase64: string,
  userHint?: string,
): Promise<ParsedScheduleFromVision> {
  return (await parseVisionFromImage(imageBase64, 'schedule', userHint)) as ParsedScheduleFromVision
}
