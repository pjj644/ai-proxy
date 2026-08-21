import { tool, StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

/**
 * 统一控制引擎（Universal App Control Engine）工具 Schema 定义。
 * 仅给 LLM bindTools 用，实际执行在手机端 ToolExecutor。
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
  // 5 大核心元工具
  app_data_query: { requiresConfirmation: false, riskLevel: 'low' },
  app_data_mutate: { requiresConfirmation: true, riskLevel: 'medium' },
  app_control: { requiresConfirmation: true, riskLevel: 'high' },
  campus_search: { requiresConfirmation: false, riskLevel: 'low' },
  app_pipeline: { requiresConfirmation: true, riskLevel: 'medium' },

  // 高阶辅助工具
  ask_user_clarification: { requiresConfirmation: false, riskLevel: 'low' },
  generate_study_plan: { requiresConfirmation: false, riskLevel: 'low' },
  parse_text_to_schedule: { requiresConfirmation: false, riskLevel: 'low' },
  get_current_page_context: { requiresConfirmation: false, riskLevel: 'low' },
  execute_page_action: { requiresConfirmation: false, riskLevel: 'low' },

  // 向后兼容保留
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
  query_campus_guide: { requiresConfirmation: false, riskLevel: 'low' },
  search_jwc_news: { requiresConfirmation: false, riskLevel: 'low' },
}

export function getToolMeta(name: string, args?: Record<string, any>): ToolMeta {
  if (name === 'app_control' && args && args.action === 'navigate') {
    return { requiresConfirmation: false, riskLevel: 'low' }
  }
  return toolMeta[name] || { requiresConfirmation: false, riskLevel: 'low' }
}

export const tools: StructuredTool[] = [
  // 1. 统一数据智能查询器
  tool(deviceStub, {
    name: 'app_data_query',
    description:
      '【首选数据查询工具】统一查询 App 内所有核心数据（课表、考试、成绩/GPA、日程、系统日历、提醒配置、系统时间与教学周）。支持按日期、教学周、星期、课程名、教师、教室、GPA范围等任意维度多条件组合过滤。涉及"今天/明天/这周"等相对时间时，可先查 system_info 或直接带日期过滤。',
    schema: z.object({
      domain: z
        .enum(['course', 'exam', 'grade', 'schedule', 'calendar', 'reminder_setting', 'system_info'])
        .describe(
          '查询的数据领域：course(课程课表), exam(考试安排与倒计时), grade(成绩列表与GPA), schedule(日程与自定义事件), calendar(系统日历事件), reminder_setting(提醒配置), system_info(当前时间/星期/教学周/学期)',
        ),
      filter: z
        .object({
          date: z.string().optional().describe('指定日期，格式 YYYY-MM-DD（自动换算教学周与星期）'),
          week: z.number().optional().describe('指定教学周数（1-20）'),
          dayOfWeek: z.number().optional().describe('星期几（1=周一 ... 7=周日）'),
          keyword: z.string().optional().describe('关键词过滤（匹配课程名/考试名/日程标题/地点）'),
          teacher: z.string().optional().describe('教师姓名过滤（针对 course）'),
          room: z.string().optional().describe('教室/地点过滤'),
          upcomingOnly: z.boolean().optional().describe('仅查询未来即将到来的项目（针对 exam/schedule）'),
          semesterId: z.number().optional().describe('学期ID过滤（针对 grade/exam/course）'),
          minGpa: z.number().optional().describe('最低绩点（针对 grade）'),
          maxGpa: z.number().optional().describe('最高绩点（针对 grade）'),
          type: z.string().optional().describe('日程类型过滤：custom(自定义), assignment(作业), course(课程), exam(考试)'),
          startDate: z.string().optional().describe('起始日期 YYYY-MM-DD（针对 calendar/schedule）'),
          endDate: z.string().optional().describe('结束日期 YYYY-MM-DD（针对 calendar/schedule）'),
        })
        .optional()
        .describe('多维度过滤条件对象'),
      limit: z.number().optional().describe('返回最大记录数量限制'),
    }),
  }),

  // 2. 统一数据变更器
  tool(deviceStub, {
    name: 'app_data_mutate',
    description:
      '【统一数据变更工具】创建、修改或删除日程、日历事件及提醒配置。需要用户在端侧确认后执行。',
    schema: z.object({
      domain: z.enum(['schedule', 'calendar', 'reminder_setting']).describe('变更的数据领域'),
      action: z.enum(['create', 'update', 'delete']).describe('操作类型：create(创建), update(更新/编辑), delete(删除)'),
      payload: z
        .record(z.string(), z.any())
        .describe(
          '变更载荷数据：\n' +
            '- create 日程: { title: string, date: "YYYY-MM-DD", startTime: "HH:mm", endTime: "HH:mm", location?: string, description?: string, type?: "custom"|"assignment" }\n' +
            '- update 日程: { eventId: string, title?: string, date?: string, startTime?: string, endTime?: string, location?: string, description?: string, type?: string }\n' +
            '- delete 日程: { eventId: string }\n' +
            '- delete 日历: { calendarEventId: number }\n' +
            '- reminder_setting: { type: "exam"|"course"|"custom"|"assignment", enabled?: boolean, minutes?: number }',
        ),
      syncCalendar: z.boolean().optional().describe('是否同步写入系统日历（对日程生效，默认 true）'),
      remindMinutesBefore: z.number().optional().describe('写入日历时的提前提醒分钟数，默认 30'),
    }),
  }),

  // 3. 统一应用与系统控制
  tool(deviceStub, {
    name: 'app_control',
    description:
      '【统一应用控制工具】控制页面路由跳转、云端同步/恢复、提醒数据全量刷新等系统级操作。',
    schema: z.object({
      action: z
        .enum(['navigate', 'sync_cloud', 'download_cloud', 'refresh_reminders'])
        .describe('控制指令类型：navigate(页面跳转), sync_cloud(同步到云端), download_cloud(从云端恢复), refresh_reminders(刷新提醒)'),
      params: z
        .object({
          page: z
            .enum([
              'course_table',
              'exam',
              'grade',
              'schedule',
              'settings',
              'course_import',
              'exam_import',
              'grade_import',
              'assistant',
              'home',
            ])
            .optional()
            .describe('目标页面标识（action 为 navigate 时必填）'),
          syncScope: z.enum(['all', 'courses', 'exams']).optional().describe('云同步范围（默认 all）'),
        })
        .optional()
        .describe('控制指令附加参数'),
    }),
  }),

  // 4. 统一校园知识与教务检索
  tool(deviceStub, {
    name: 'campus_search',
    description:
      '【统一校园智搜工具】检索成电（电子科技大学）校园生活指南（校车时刻/缓考补考/保研/校医院/场馆开放）以及教务处官网实时公告新闻。',
    schema: z.object({
      query: z.string().describe('检索关键词或查询问题（如"清水河到沙河校车"、"缓考流程"、"四六级报名"）'),
      source: z
        .enum(['guide', 'jwc_news', 'auto'])
        .optional()
        .describe('检索源：guide(本地校园生活指南知识库), jwc_news(教务处官网实时检索), auto(默认自动，优先本地知识库)'),
      category: z
        .enum(['bus', 'academic_policy', 'hospital', 'facilities', 'all'])
        .optional()
        .describe('校园生活指南细分分类（可选）'),
    }),
  }),

  // 5. 声明式复合流水线批处理
  tool(deviceStub, {
    name: 'app_pipeline',
    description:
      '【声明式流水线执行工具】当遇到复合任务时（如"查下周二空闲时间 ➔ 创建自习日程 ➔ 写入日历"），一次性生成有序的原子步骤列表由端侧批量执行，避免多次网络往返。',
    schema: z.object({
      steps: z
        .array(
          z.object({
            stepId: z.string().describe('步骤标识，如 step1, step2'),
            tool: z
              .enum(['app_data_query', 'app_data_mutate', 'app_control', 'campus_search'])
              .describe('要执行的元工具名称'),
            args: z.record(z.string(), z.any()).describe('该元工具的执行参数'),
          }),
        )
        .describe('顺序执行的步骤数组'),
    }),
  }),

  // 6. 高阶智能辅助工具
  tool(deviceStub, {
    name: 'ask_user_clarification',
    description:
      '【信息补充与主动反问工具】当用户指令意图模糊、缺少关键必要信息（如具体时间/地点/科目/日程类型）或存在多个选项冲突时调用，向端侧下发反问问题及结构化可选卡片。',
    schema: z.object({
      question: z.string().describe('向用户清晰反问的具体问题或提示'),
      options: z
        .array(z.string())
        .optional()
        .describe('给用户提供的快捷选择候选项列表（例如 ["14:00 - 16:00 (图书馆)", "16:30 - 18:30 (品学楼)"]）'),
      allowFreeInput: z.boolean().optional().describe('是否允许用户自由文本输入补充，默认 true'),
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
    name: 'parse_text_to_schedule',
    description: '从自然语言通知文本、讲座通知、作业通知中智能提取事件名称、日期、开始与结束时间、地点，并直接准备日程结构',
    schema: z.object({
      rawText: z.string().describe('用户提供的通知或活动原始文本内容'),
    }),
  }),
  tool(deviceStub, {
    name: 'get_current_page_context',
    description: '获取用户手机当前所在的页面名称、数据概览及可用操作集合。当需要分析用户当前页面或提供针对性建议时调用。',
    schema: z.object({}),
  }),
  tool(deviceStub, {
    name: 'execute_page_action',
    description: '在当前页面触发 UI 交互动作（如切换周次、切换Tab、触发导入、显示聚光灯高亮引导等）或指导用户操作。',
    schema: z.object({
      action: z
        .string()
        .describe('动作类型：switch_week(切换周次), switch_tab(切换Tab), import_courses(导入课表), import_grades(导入成绩), import_exams(导入考试), show_guidance(高亮聚光灯引导)'),
      params: z.record(z.string(), z.any()).optional().describe('动作参数，如 { week: 5 }, { targetElementId: "import_btn", hintText: "点击这里导入" }'),
    }),
  }),
]
