import { tool, StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * 工具 schema 定义（仅给 LLM bindTools 用，实际执行在手机端 ToolExecutor）。
 * 与应用端 ToolRegistry.ets 一一对应，改动需同步。
 */

const deviceStub = async (): Promise<never> => {
  throw new Error('Tool executed on device, not on backend.')
}

export interface ToolMeta {
  requiresConfirmation: boolean
  riskLevel: 'low' | 'medium' | 'high'
}

export const toolMeta: Record<string, ToolMeta> = {
  query_today_courses: { requiresConfirmation: false, riskLevel: 'low' },
  query_week_courses: { requiresConfirmation: false, riskLevel: 'low' },
  query_current_week: { requiresConfirmation: false, riskLevel: 'low' },
  query_next_exam: { requiresConfirmation: false, riskLevel: 'low' },
  query_all_exams: { requiresConfirmation: false, riskLevel: 'low' },
  query_grades: { requiresConfirmation: false, riskLevel: 'low' },
  query_gpa: { requiresConfirmation: false, riskLevel: 'low' },
  query_schedule: { requiresConfirmation: false, riskLevel: 'low' },
  check_login_status: { requiresConfirmation: false, riskLevel: 'low' },
  check_time_conflict: { requiresConfirmation: false, riskLevel: 'low' },
  query_reminder_settings: { requiresConfirmation: false, riskLevel: 'low' },
  has_course_data: { requiresConfirmation: false, riskLevel: 'low' },
  create_schedule: { requiresConfirmation: true, riskLevel: 'medium' },
  delete_schedule: { requiresConfirmation: true, riskLevel: 'medium' },
  sync_courses_to_cloud: { requiresConfirmation: true, riskLevel: 'high' },
  sync_exams_to_cloud: { requiresConfirmation: true, riskLevel: 'high' },
  sync_all_to_cloud: { requiresConfirmation: true, riskLevel: 'high' },
  download_all_from_cloud: { requiresConfirmation: true, riskLevel: 'high' },
  set_reminder_enabled: { requiresConfirmation: true, riskLevel: 'low' },
  set_remind_minutes: { requiresConfirmation: true, riskLevel: 'low' },
  refresh_reminders: { requiresConfirmation: true, riskLevel: 'low' },
  navigate_to_page: { requiresConfirmation: false, riskLevel: 'low' },
  get_current_datetime: { requiresConfirmation: false, riskLevel: 'low' },
  query_courses_by_date: { requiresConfirmation: false, riskLevel: 'low' },
  query_tomorrow_courses: { requiresConfirmation: false, riskLevel: 'low' },
  query_course_by_name: { requiresConfirmation: false, riskLevel: 'low' },
  list_calendar_events: { requiresConfirmation: false, riskLevel: 'low' },
  add_to_calendar: { requiresConfirmation: true, riskLevel: 'medium' },
  add_exam_to_calendar: { requiresConfirmation: true, riskLevel: 'medium' },
  add_course_to_calendar: { requiresConfirmation: true, riskLevel: 'medium' },
  remove_calendar_event: { requiresConfirmation: true, riskLevel: 'medium' },
  update_schedule: { requiresConfirmation: true, riskLevel: 'medium' },
  generate_study_plan: { requiresConfirmation: false, riskLevel: 'low' },
  query_campus_guide: { requiresConfirmation: false, riskLevel: 'low' },
  parse_text_to_schedule: { requiresConfirmation: false, riskLevel: 'low' },
  search_jwc_news: { requiresConfirmation: false, riskLevel: 'low' },
}

export function getToolMeta(name: string): ToolMeta {
  return toolMeta[name] || { requiresConfirmation: false, riskLevel: 'low' }
}

export const tools: StructuredTool[] = [
  tool(deviceStub, {
    name: 'query_today_courses',
    description: '查询今天的课程安排，返回课程名称、时间、教室、教师等信息',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_week_courses',
    description: '查询指定周的课程安排，不传weekNumber则查询本周',
    schema: z.object({ weekNumber: z.number().optional().describe('教学周数，如1-20，不传则查询当前周') }),
  }),
  tool(deviceStub, {
    name: 'query_current_week',
    description: '查询当前是第几教学周',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_next_exam',
    description: '查询最近一场即将到来的考试，包含倒计时信息',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_all_exams',
    description: '查询所有考试安排',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_grades',
    description: '查询成绩列表和GPA信息',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_gpa',
    description: '查询GPA（总评绩点和最新学期绩点）',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_schedule',
    description: '查询日程安排，可指定日期筛选',
    schema: z.object({ date: z.string().optional().describe('日期，格式YYYY-MM-DD，不传则查询所有日程') }),
  }),
  tool(deviceStub, {
    name: 'check_login_status',
    description: '检查用户是否已登录，返回登录状态和用户邮箱',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'check_time_conflict',
    description: '检查指定日期和时间段是否有日程冲突',
    schema: z.object({
      date: z.string().describe('日期，格式YYYY-MM-DD'),
      startTime: z.string().describe('开始时间，格式HH:mm'),
      endTime: z.string().describe('结束时间，格式HH:mm'),
    }),
  }),
  tool(deviceStub, {
    name: 'query_reminder_settings',
    description: '查询当前的提醒设置，包括总开关、各分类开关和提醒时间',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'has_course_data',
    description: '检查是否有课表数据',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'create_schedule',
    description: '创建一条自定义日程，需要提供标题、日期和时间',
    schema: z.object({
      title: z.string().describe('日程标题'),
      date: z.string().describe('日期，格式YYYY-MM-DD'),
      startTime: z.string().describe('开始时间，格式HH:mm'),
      endTime: z.string().describe('结束时间，格式HH:mm'),
      location: z.string().optional().describe('地点，可选'),
      description: z.string().optional().describe('描述，可选'),
      type: z.string().optional().describe('类型：custom(自定义)或assignment(作业)，默认custom'),
    }),
  }),
  tool(deviceStub, {
    name: 'delete_schedule',
    description: '删除指定ID的日程',
    schema: z.object({ eventId: z.string().describe('要删除的日程ID') }),
  }),
  tool(deviceStub, {
    name: 'sync_courses_to_cloud',
    description: '将本地课表数据同步到云端，需要用户已登录',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'sync_exams_to_cloud',
    description: '将本地考试数据同步到云端，需要用户已登录',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'sync_all_to_cloud',
    description: '将本地全部数据（课表+考试）同步到云端，需要用户已登录',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'download_all_from_cloud',
    description: '从云端恢复全部数据到本地，需要用户已登录',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'set_reminder_enabled',
    description: '设置某类日程的提醒开关',
    schema: z.object({
      type: z.string().describe('类型：exam/course/custom/assignment'),
      enabled: z.boolean().describe('是否启用'),
    }),
  }),
  tool(deviceStub, {
    name: 'set_remind_minutes',
    description: '设置某类日程的提醒提前时间',
    schema: z.object({
      type: z.string().describe('类型：exam/course/custom/assignment'),
      minutes: z.number().describe('提前提醒的分钟数'),
    }),
  }),
  tool(deviceStub, {
    name: 'refresh_reminders',
    description: '刷新全部提醒，重新同步课程和考试到日程并重建提醒',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'navigate_to_page',
    description: '导航到应用内指定页面',
    schema: z.object({
      page: z.string().describe('页面标识：course_table(课表)、exam(考试)、grade(成绩)、schedule(日程)、settings(设置)、course_import(导入课表)、exam_import(导入考试)、grade_import(导入成绩)、assistant(AI助手)、home(首页)'),
    }),
  }),
  tool(deviceStub, {
    name: 'get_current_datetime',
    description: '获取当前日期、时间、星期几、第几教学周、当前学期等基础时间信息。涉及"今天/明天/本周/这学期"等相对时间时务必先调用此工具，避免凭空猜测日期。',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_courses_by_date',
    description: '查询指定日期的课程安排（自动换算教学周与星期）',
    schema: z.object({ date: z.string().describe('日期，格式YYYY-MM-DD') }),
  }),
  tool(deviceStub, {
    name: 'query_tomorrow_courses',
    description: '查询明天的课程安排',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'query_course_by_name',
    description: '按课程名查询上课时间、教室、教师及生效周次（支持模糊匹配）',
    schema: z.object({ courseName: z.string().describe('课程名称或关键词') }),
  }),
  tool(deviceStub, {
    name: 'list_calendar_events',
    description: '列出已写入系统日历的本应用事件，默认查询未来30天',
    schema: z.object({
      startDate: z.string().optional().describe('起始日期YYYY-MM-DD，默认今天'),
      endDate: z.string().optional().describe('结束日期YYYY-MM-DD，默认今天+30天'),
    }),
  }),
  tool(deviceStub, {
    name: 'add_to_calendar',
    description: '创建一条日程并写入系统日历，可设置提前若干分钟提醒。会在应用内日程与系统日历各建一份并互相关联。',
    schema: z.object({
      title: z.string().describe('日程标题'),
      date: z.string().describe('日期，格式YYYY-MM-DD'),
      startTime: z.string().describe('开始时间，格式HH:mm'),
      endTime: z.string().describe('结束时间，格式HH:mm'),
      remindMinutesBefore: z.number().optional().describe('提前提醒的分钟数，默认30'),
      location: z.string().optional().describe('地点，可选'),
      description: z.string().optional().describe('描述，可选'),
      type: z.string().optional().describe('类型：custom(自定义)或assignment(作业)，默认custom'),
    }),
  }),
  tool(deviceStub, {
    name: 'add_exam_to_calendar',
    description: '把一场考试写入系统日历并设置提前提醒。不传courseName则取最近一场即将到来的考试。',
    schema: z.object({
      courseName: z.string().optional().describe('课程名称或关键词，不传则取最近一场考试'),
      remindMinutesBefore: z.number().optional().describe('提前提醒的分钟数，默认30'),
    }),
  }),
  tool(deviceStub, {
    name: 'add_course_to_calendar',
    description: '把课程写入系统日历并设置提前提醒。可指定某门课与日期；不传courseName则添加当天全部课程。',
    schema: z.object({
      courseName: z.string().optional().describe('课程名称或关键词，不传则添加当天全部课程'),
      date: z.string().optional().describe('日期YYYY-MM-DD，默认今天'),
      remindMinutesBefore: z.number().optional().describe('提前提醒的分钟数，默认15'),
    }),
  }),
  tool(deviceStub, {
    name: 'remove_calendar_event',
    description: '从系统日历移除指定事件（按系统日历事件ID）',
    schema: z.object({ calendarEventId: z.number().describe('系统日历事件ID，可通过list_calendar_events获取') }),
  }),
  tool(deviceStub, {
    name: 'update_schedule',
    description: '编辑已有的应用内日程，修改其字段。若该日程已关联系统日历事件，会同步更新日历。',
    schema: z.object({
      eventId: z.string().describe('要编辑的日程ID'),
      title: z.string().optional().describe('新标题'),
      date: z.string().optional().describe('新日期YYYY-MM-DD'),
      startTime: z.string().optional().describe('新开始时间HH:mm'),
      endTime: z.string().optional().describe('新结束时间HH:mm'),
      location: z.string().optional().describe('新地点'),
      description: z.string().optional().describe('新描述'),
      type: z.string().optional().describe('新类型：custom或assignment'),
    }),
  }),
  tool(deviceStub, {
    name: 'generate_study_plan',
    description: '分析用户所有即将到来的考试科目，结合剩余天数与难易度，自动生成合理的考前每日复习冲刺任务计划',
    schema: z.object({
      dailyHours: z.number().optional().describe('每日可用复习小时数，默认 4 小时'),
      focusCourse: z.string().optional().describe('重点突击的课程名称，可选'),
    }),
  }),
  tool(deviceStub, {
    name: 'query_campus_guide',
    description: '查询成电（电子科技大学）校园生活指南与校务政策，包括清水河/沙河校车时刻、重修免修、成绩保研规则、校医院与办事指南',
    schema: z.object({
      category: z.enum(['bus', 'academic_policy', 'hospital', 'facilities', 'all']).describe('查询分类：bus(校车), academic_policy(教务/保研/免修), hospital(就医), facilities(场馆/图书馆), all(全部)'),
      keyword: z.string().optional().describe('具体查询关键词'),
    }),
  }),
  tool(deviceStub, {
    name: 'parse_text_to_schedule',
    description: '从自然语言通知文本、讲座通知、作业通知中智能提取事件名称、日期、开始与结束时间、地点，并直接准备日程结构',
    schema: z.object({
      rawText: z.string().describe('用户提供的通知或活动原始文本内容'),
    }),
  }),
  tool(deviceStub, {
    name: 'search_jwc_news',
    description: '从电子科技大学教务处官网(www.jwc.uestc.edu.cn)实时检索最新教务通知、考试公告、选拔公示与新闻。优先使用本地query_campus_guide；仅当本地知识库无相关信息，且问题明确属于教务处最新动态/公告时使用。',
    schema: z.object({
      keyword: z.string().describe('检索关键词，如"四六级"、"转专业"、"补考"、"选课"'),
      category: z.enum(['all', 'jxtz', 'kwtz', 'sjjx', 'xjgl']).optional().describe('分类：all(全部)、jxtz(教学通知)、kwtz(考务通知)、sjjx(实践教学)、xjgl(学籍管理)'),
    }),
  }),
]

