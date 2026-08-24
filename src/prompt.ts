import { campusKnowledge } from './knowledge/store'

/**
 * 动态上下文工程 (Dynamic Context Engineering)
 * 将 16KB 静态臃肿 Prompt 解耦为：
 * 1. BASE_SYSTEM_PROMPT: 核心人设、元工具调用规范、时间换算与 Claude 风格排版规范（极简轻量，约 400 tokens）
 * 2. 权威校内服务网址基准库 (VERIFIED_CAMPUS_URLS)
 * 3. 模块化 App 功能指南 (APP_MODULE_GUIDES)
 * 4. 按需动态检索注入引擎 (getRelevantContext)
 */

export const BASE_SYSTEM_PROMPT: string =
  '你是"成电校园助手"App的内置AI Agent，专为UESTC(电子科技大学)学生服务。你不仅能回答问题，还能直接控制整个应用并执行各项数据操作。\n\n' +
  '【核心控制元工具箱】：\n' +
  '1. app_data_query：统一数据智能查询器（课表/考试/成绩/日程/日历/提醒/系统时间与教学周）。\n' +
  '   - 多维过滤：查询指定教室时使用 room 字段；按教师过滤使用 teacher；按绩点/高分过滤使用 minGpa/maxGpa (如 minGpa: 3.7)；按周次过滤使用 week (1-20)；按星期过滤使用 dayOfWeek (1-7)；按具体日期使用 date (YYYY-MM-DD)。\n' +
  '2. app_data_mutate：统一数据变更器（创建/更新/删除日程、日历事件及提醒配置）。端侧会自动弹出确认框，直接调用工具即可，切勿在对话中反复文字询问确认。\n' +
  '3. app_control：统一应用系统控制（页面跳转 navigate、云端同步/恢复 sync_cloud/download_cloud、刷新提醒 refresh_reminders）。\n' +
  '4. campus_search：统一成电校园智搜（校车、校规、办事指南、教务处公告）。\n' +
  '5. app_pipeline：声明式复合流水线批处理（当用户在一个请求中提出多个连续动作时，如"先查空闲再建日程"，优先使用 app_pipeline 一次性下发有序 steps）。\n' +
  '6. generate_study_plan：当用户要求根据即将到来的考试生成考前复习/突击规划时直接调用。\n' +
  '7. get_current_page_context / execute_page_action：当前页面感知与 UI 引导/操作。\n\n' +
  '【核心执行与安全原则】：\n' +
  '1. 优先使用元工具获取真实数据，严禁臆造；\n' +
  '2. 如果工具返回"用户拒绝了此操作"，说明用户在端侧确认框中点击了拒绝，请友善告知操作已取消；\n' +
  '3. 当用户询问校内办事流程、网站入口或系统使用时，简要说明步骤并在回答中附带标准 Markdown 链接 [服务名称](URL)；\n' +
  '4. 仅回答与成电校园及本App相关的问题，用中文简洁专业地回答。\n\n' +
  '【输出排版与 Markdown 规范（专业极简 Claude Code 风格）】：\n' +
  '1. 严禁滥用 Emoji 图标（严禁出现 📌、🎒、👨‍🏫、📍、⏰、📝、📚 等表情符号），保持极简专业；\n' +
  '2. 严禁输出大宽度表格导致手机端字符挤压，涉及多门课程/考试/成绩时采用三级标题与列表排版；\n' +
  '3. 属性字段（教师、教室、时间）分行展示。'

/**
 * 权威校内官方网址基准库（严格白名单，严禁臆造或拼错协议）
 */
export const VERIFIED_CAMPUS_URLS: Array<{
  keywords: string[]
  name: string
  url: string
  notes?: string
}> = [
  {
    keywords: ['邮箱', 'mail', '学生邮箱'],
    name: '电子科技大学学生邮箱',
    url: 'http://mail.std.uestc.edu.cn/',
    notes: '必须使用 http 协议以确保内嵌加载，切勿使用 https',
  },
  {
    keywords: ['门户', '信息门户', '网上服务大厅', '网上服务', '云中成电', 'eportal'],
    name: '信息门户（云中成电）',
    url: 'https://online.uestc.edu.cn/',
  },
  {
    keywords: ['电费', '宿舍电费', '寝室电费', '充值电费'],
    name: '云中成电（信息门户）',
    url: 'https://online.uestc.edu.cn/',
    notes: '寝室电费充值依赖门户动态 Token，必须引导用户登录信息门户并在应用列表中点击【寝室电费充值】',
  },
  {
    keywords: ['一卡通', '校园卡', '掌上校园', '余额', '卡余额', '饭卡'],
    name: '一卡通掌上校园',
    url: 'https://mapp.uestc.cn/site/ipasscd/index',
  },
  {
    keywords: ['正版软件', '微软正版', 'windows', 'office', 'matlab'],
    name: '成电正版软件平台',
    url: 'https://ms.uestc.edu.cn/',
  },
  {
    keywords: ['研修室', '研讨室', '图书馆预约', '借阅', '图书馆研修室'],
    name: '图书馆研修室预约',
    url: 'https://reservelib.uestc.edu.cn/',
    notes: '需在校园网或 WebVPN 环境下访问',
  },
  {
    keywords: ['vpn', 'webvpn', '校外访问', '内网'],
    name: '成电WebVPN',
    url: 'https://webvpn.uestc.edu.cn/',
  },
  {
    keywords: ['研究生', '研究生系统', '培养系统'],
    name: '研究生管理系统',
    url: 'https://yjsjy.uestc.edu.cn/pyxx/jzsso/login',
  },
  {
    keywords: ['学工', '智慧学工', '请假', '奖学金', '辅导员'],
    name: '智慧学工平台',
    url: 'https://jzsz.uestc.edu.cn/',
  },
  {
    keywords: ['财务', '报销', '学费', '财务系统'],
    name: '财务综合查询系统',
    url: 'https://cwcx.uestc.edu.cn/',
    notes: '需校园网或 WebVPN',
  },
  {
    keywords: ['清水河畔', 'bbs', '论坛', '河畔'],
    name: '清水河畔BBS',
    url: 'https://bbs.uestc.edu.cn/new',
  },
  {
    keywords: ['教师主页', '老师主页', '导师主页'],
    name: '教师个人主页系统',
    url: 'https://faculty.uestc.edu.cn/',
  },
  {
    keywords: ['慕课', 'mooc', '成电慕课'],
    name: '成电慕课平台',
    url: 'https://mooc.uestc.edu.cn/',
  },
  {
    keywords: ['图书馆', '馆藏', '借书', '图书查询'],
    name: '图书馆官网',
    url: 'https://www.lib.uestc.edu.cn/',
  },
]

/**
 * 模块化 App 功能指南
 */
export const APP_MODULE_GUIDES: Record<string, { triggers: string[]; content: string }> = {
  course_import: {
    triggers: ['导入课表', '课表导入', '抓取课表', '怎么导入课程'],
    content:
      '【课表导入指南】：在课表页面点击右上角【导入】按钮，应用将内嵌打开教务系统(eams.uestc.edu.cn)，登录后即可全自动解析并导入全学期课表。非校园网环境会自动切换 WebVPN 隧道。',
  },
  exam_grade_import: {
    triggers: ['导入考试', '导入成绩', '抓取考试', '抓取成绩'],
    content:
      '【考试与成绩导入指南】：在考试或成绩页面点击右上角【导入】，登录统一身份认证后，系统将自动轮询解析教务系统数据并同步到本地。',
  },
  cloud_sync: {
    triggers: ['云同步', '同步到云端', '云备份', '恢复数据', '数据同步'],
    content:
      '【云同步指南】：在【我的】->【应用设置】->【数据同步】中，支持将课表和考试增量备份至华为云 CloudDB，更换设备或重新安装后可一键下载恢复。',
  },
  settings: {
    triggers: ['深色模式', '暗黑模式', '光感', '材质', '动画速度', '背景图片'],
    content:
      '【个性化设置指南】：在【我的】->【应用设置】中，支持浅色/深色/跟随系统切换，并可调节沉浸光感材质等级、自定义背景图片与动效曲线。',
  },
  calendar_reminder: {
    triggers: ['提醒设置', '系统日历', '日历同步', '怎么提醒', '日历权限'],
    content:
      '【日历与提醒联动】：日程管理支持双提醒机制（后台代理提醒与系统日历写入）。在日程设置中可自定义考试/课程/作业的提前提醒分钟数，并支持一键写入系统日历。',
  },
}

/**
 * 动态上下文检索引擎 (Dynamic Context Retriever)
 */
export function getRelevantContext(userInput: string): string {
  if (!userInput || userInput.trim().length === 0) return ''
  const query = userInput.trim().toLowerCase()
  const injectedSections: string[] = []

  // 1. 匹配官方校内服务网址基准库 (Top Matches)
  const matchedUrls = VERIFIED_CAMPUS_URLS.filter((item) =>
    item.keywords.some((kw) => query.includes(kw.toLowerCase())),
  )

  if (matchedUrls.length > 0) {
    const urlLines = matchedUrls.slice(0, 3).map((item) => {
      let line = `- [${item.name}](${item.url})`
      if (item.notes) line += ` (${item.notes})`
      return line
    })
    injectedSections.push(`【相关校内官方服务网址参考（请严格使用以下链接）】:\n${urlLines.join('\n')}`)
  }

  // 2. 匹配 App 模块详细操作指南
  for (const moduleKey of Object.keys(APP_MODULE_GUIDES)) {
    const mod = APP_MODULE_GUIDES[moduleKey]
    if (mod.triggers.some((trig) => query.includes(trig))) {
      injectedSections.push(mod.content)
      break // 单次最多注入 1 个 App 模块指南
    }
  }

  // 3. 动态检索 CampusKnowledgeStore（校规/校车/场馆/办事流程，取 Top 2）
  // 仅当包含常见办事、生活、场馆、校规等提问特征时检索，避免常规课表查询产生噪音
  const isKnowledgeQuery =
    query.includes('校车') ||
    query.includes('班车') ||
    query.includes('医院') ||
    query.includes('就医') ||
    query.includes('场馆') ||
    query.includes('游泳') ||
    query.includes('健身') ||
    query.includes('补考') ||
    query.includes('重修') ||
    query.includes('学分') ||
    query.includes('保研') ||
    query.includes('证明') ||
    query.includes('成绩单') ||
    query.includes('借阅') ||
    query.includes('办事') ||
    query.includes('怎么') ||
    query.includes('如何')

  if (isKnowledgeQuery) {
    const knowledgeResults = campusKnowledge.search({ keyword: query, limit: 2 })
    if (knowledgeResults && knowledgeResults.length > 0) {
      const kLines = knowledgeResults.map(
        (item) => `• 【${item.title}】: ${item.summary || item.content.slice(0, 180)}`,
      )
      injectedSections.push(`【相关校园参考知识库】:\n${kLines.join('\n')}`)
    }
  }

  return injectedSections.join('\n\n')
}

/**
 * 构造注入给 LangGraph 大模型的 System Prompt
 */
export function buildSystemPrompt(userInput: string, phoneContext?: Record<string, any>): string {
  let prompt = BASE_SYSTEM_PROMPT

  // 注入端侧动态上下文（如当前活跃页面快照）
  if (phoneContext && Object.keys(phoneContext).length > 0) {
    prompt += `\n\n【用户端侧当前状态感知】: 当前停留在页面: ${phoneContext.currentPage || '未知'}`
    if (phoneContext.pageDataSummary) {
      prompt += `，页面数据快照: ${JSON.stringify(phoneContext.pageDataSummary)}`
    }
  }

  // 注入按需检索的动态知识与官方服务
  const dynamicContext = getRelevantContext(userInput)
  if (dynamicContext.length > 0) {
    prompt += `\n\n${dynamicContext}`
  }

  return prompt
}
