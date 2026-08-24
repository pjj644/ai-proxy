import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CampusKnowledgeItem } from './types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * T6b 知识库只读端点的响应装配层。
 *
 * 字段对齐说明（与鸿蒙端保持一致，改动需同步）：
 * - 校车时刻对齐 Application/entry/src/main/ets/model/BusScheduleModel.ets 的 BusItem 接口：
 *   { id, time, departure: 'qsh'|'sh', destination, departureName, destinationName,
 *     routeDescription, busType, isWeekend }
 * - 校园指南对齐 Application/entry/src/main/ets/common/agent/ToolExecutor.ets 中
 *   GuideItem / GuideResultData 结构：{ id?, title, category, content, details? }，
 *   聚合语义为 GuideResultData（category/keyword/count/guides）。
 * 源 JSON（knowledge/data/*.json）为知识条目形态（title/content/details 文本），
 * 形状不符时在本层做映射，绝不修改源数据文件。
 */

const DATA_DIR = path.join(__dirname, 'data')

function readDataFile(fileName: string): CampusKnowledgeItem[] {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, fileName), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CampusKnowledgeItem[]) : []
  } catch (e) {
    console.error(`[knowledge/api] failed to read ${fileName}:`, e)
    return []
  }
}

/** 与前端 BusScheduleModel.getBusList 输出一一对应的班车条目 */
export interface AlignedBusItem {
  id: string
  time: string
  departure: 'qsh' | 'sh'
  destination: 'sh' | 'qsh'
  departureName: string
  destinationName: string
  routeDescription: string
  busType: string
  isWeekend: boolean
}

/** 与前端 GuideItem 对齐的指南条目 */
export interface AlignedGuideItem {
  id?: string
  title: string
  category: string
  content: string
  details?: string
}

const CAMPUS_NAME_MAP: Record<string, string> = {
  qsh: '清水河校区',
  sh: '沙河校区',
}

// 与前端 BusScheduleModel 一致的高峰直达班次判定规则
const PEAK_DIRECT_TIMES = new Set(['07:10', '07:30', '17:00', '17:40'])

function extractTimes(segment: string): string[] {
  const matches = segment.match(/\d{1,2}:\d{2}/g)
  return matches || []
}

/**
 * 从知识条目的 content 文本中解析「工作日班次」「周末及法定节假日」两段时间表，
 * 展开为逐班次的 BusItem 数组（id 编码规则与前端 getBusList 保持一致）。
 */
function expandBusItems(entry: CampusKnowledgeItem): AlignedBusItem[] {
  // 仅双向时刻表条目可展开（bus_qs_sh / bus_sh_qs），其余为指南性内容
  const isQshToSh = entry.id === 'bus_qs_sh' || entry.title.includes('清水河 ➔ 沙河')
  const isShToQsh = entry.id === 'bus_sh_qs' || entry.title.includes('沙河 ➔ 清水河')
  if (!isQshToSh && !isShToQsh) return []

  const departure: 'qsh' | 'sh' = isQshToSh ? 'qsh' : 'sh'
  const destination: 'sh' | 'qsh' = isQshToSh ? 'sh' : 'qsh'
  const departureName = CAMPUS_NAME_MAP[departure]
  const destinationName = CAMPUS_NAME_MAP[destination]
  const routeDescription = `${departureName}主楼 ➔ ${destinationName}主楼`

  const content = entry.content || ''
  const workdayMatch = content.match(/【工作日班次】([^【]*)/)
  const weekendMatch = content.match(/【周末(?:及法定节假日)?】([^【]*)/)
  const workdayTimes = workdayMatch ? extractTimes(workdayMatch[1]) : []
  const weekendTimes = weekendMatch ? extractTimes(weekendMatch[1]) : []

  const buildItems = (times: string[], isWeekend: boolean): AlignedBusItem[] =>
    times.map((time, idx) => ({
      id: `bus_${departure}_${isWeekend ? 'weekend' : 'workday'}_${idx}_${time.replace(':', '')}`,
      time,
      departure,
      destination,
      departureName,
      destinationName,
      routeDescription,
      busType: PEAK_DIRECT_TIMES.has(time) ? '高峰直达' : '普通班车',
      isWeekend,
    }))

  return [...buildItems(workdayTimes, false), ...buildItems(weekendTimes, true)]
}

export interface BusSchedulePayload {
  ok: true
  count: number
  generatedAt: string
  /** 按线路分组；每组 buses[] 内的条目与前端 BusItem 接口字段完全一致 */
  data: Array<{
    departure: 'qsh' | 'sh'
    destination: 'sh' | 'qsh'
    departureName: string
    destinationName: string
    routeDescription: string
    boardingInfo?: string
    lastUpdated?: string
    buses: AlignedBusItem[]
  }>
  /** 非时刻表类交通知识（校内电瓶车、公共交通接驳），以 GuideItem 形态附带 */
  relatedGuides: AlignedGuideItem[]
}

/**
 * GET /api/v1/knowledge/bus-schedule 响应装配
 */
export function buildBusSchedulePayload(): BusSchedulePayload {
  const entries = readDataFile('bus_schedule.json')
  const routes: BusSchedulePayload['data'] = []
  const relatedGuides: AlignedGuideItem[] = []

  for (const entry of entries) {
    if (entry.category !== 'bus') continue
    const buses = expandBusItems(entry)
    if (buses.length > 0) {
      const first = buses[0]
      routes.push({
        departure: first.departure,
        destination: first.destination,
        departureName: first.departureName,
        destinationName: first.destinationName,
        routeDescription: first.routeDescription,
        boardingInfo: entry.details,
        lastUpdated: entry.lastUpdated,
        buses,
      })
    } else {
      relatedGuides.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        content: entry.content,
        details: entry.details,
      })
    }
  }

  return {
    ok: true,
    count: routes.reduce((acc, r) => acc + r.buses.length, 0),
    generatedAt: new Date().toISOString(),
    data: routes,
    relatedGuides,
  }
}

/**
 * 「校园指南」语义聚合的源文件清单（academic_policy / facilities / hospital / campus_life）
 */
const GUIDE_DATA_FILES = [
  'academic_policy.json',
  'facilities_guide.json',
  'hospital_guide.json',
  'campus_life.json',
]

export interface GuidesPayload {
  ok: true
  category: string // 对齐前端 GuideResultData.category
  keyword: string // 对齐前端 GuideResultData.keyword
  count: number
  generatedAt: string
  /** 与前端 GuideItem 结构对齐（title/category/content/details） */
  data: AlignedGuideItem[]
}

/**
 * GET /api/v1/knowledge/guides 响应装配
 * @param category 可选分类过滤（all 表示不过滤，语义同前端 queryCampusGuide）
 * @param keyword  可选关键词过滤（命中 title/content/details，大小写不敏感）
 */
export function buildGuidesPayload(category = 'all', keyword = ''): GuidesPayload {
  let guides: AlignedGuideItem[] = []
  for (const file of GUIDE_DATA_FILES) {
    for (const entry of readDataFile(file)) {
      guides.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        content: entry.content,
        details: entry.details,
      })
    }
  }

  const cat = (category || 'all').toLowerCase()
  if (cat !== 'all') {
    guides = guides.filter((g) => g.category === cat)
  }

  const kw = (keyword || '').trim().toLowerCase()
  if (kw.length > 0) {
    guides = guides.filter(
      (g) =>
        g.title.toLowerCase().includes(kw) ||
        g.content.toLowerCase().includes(kw) ||
        (g.details !== undefined && g.details.toLowerCase().includes(kw)),
    )
  }

  return {
    ok: true,
    category: cat,
    keyword: kw,
    count: guides.length,
    generatedAt: new Date().toISOString(),
    data: guides,
  }
}
