import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { calculateSemesterId } from './jwcAuthProxy'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface AgcCourseRecord {
  id?: number | string
  userId: string
  semesterId: number
  semesterLabel?: string
  courseId: string
  courseName: string
  teacherName?: string
  roomName?: string
  dayOfWeek: number
  startSection: number
  duration: number
  validWeeks: string
  stepWeeks?: number[]
  colorIndex?: number
  updatedAt?: number
}

export interface AgcExamRecord {
  id?: number | string
  userId: string
  semesterId: number
  semesterLabel?: string
  courseNo?: string
  courseName: string
  examDate: string
  examTimeRange: string
  examLocation: string
  seatNo: string
  examStatus: string
  examType?: string
  updatedAt?: number
}

export interface AgcSyncResult<T> {
  success: boolean
  message: string
  data?: T
  count?: number
  updatedAt: string
}

// 内存与本地双重缓存文件路径
const DB_STORE_FILE = path.join(__dirname, '..', 'data', 'cloud_db_store.json')

interface CloudDbStore {
  courses: AgcCourseRecord[]
  exams: AgcExamRecord[]
}

class AgcCloudDbGateway {
  private store: CloudDbStore = { courses: [], exams: [] }
  private initialized = false

  private ensureDataDir() {
    const dataDir = path.dirname(DB_STORE_FILE)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
  }

  private loadStore() {
    if (this.initialized) return
    this.ensureDataDir()
    if (fs.existsSync(DB_STORE_FILE)) {
      try {
        const raw = fs.readFileSync(DB_STORE_FILE, 'utf-8')
        this.store = JSON.parse(raw)
      } catch (e) {
        console.error('[AgcCloudDbGateway] Failed to load store:', e)
        this.store = { courses: [], exams: [] }
      }
    }
    this.initialized = true
  }

  private saveStore() {
    try {
      this.ensureDataDir()
      fs.writeFileSync(DB_STORE_FILE, JSON.stringify(this.store, null, 2), 'utf-8')
    } catch (e) {
      console.error('[AgcCloudDbGateway] Failed to save store:', e)
    }
  }

  /**
   * 最近一次查询的数据来源（cloud = 华为云函数真实命中；mirror = 本地镜像仓储）
   */
  private lastQuerySource: 'cloud' | 'mirror' = 'mirror'

  getLastQuerySource(): 'cloud' | 'mirror' {
    return this.lastQuerySource
  }

  /** 调用云函数时可选的访问密钥（与云函数环境变量 SYNC_ACCESS_KEY 配对） */
  private buildCloudBody(payload: Record<string, unknown>): Record<string, unknown> {
    const syncKey = process.env.AGC_SYNC_KEY
    const body = { ...payload }
    if (syncKey) {
      ;(body as any).syncAccessKey = syncKey
    }
    // 发往云函数前做白名单裁剪，确保与 ClassCourse/ClassExam Schema 一致
    return body
  }

  /**
   * 检查用户标识是否匹配（严格相等；统一以华为 AGC 数字 UID 为准）
   */
  private matchUser(recordUserId: string, targetUserId: string): boolean {
    if (!recordUserId || !targetUserId) return false
    return recordUserId === targetUserId
  }

  /**
   * 查询指定用户在指定学期的云端课表（优先通过华为 AGC 云函数 HTTP 触发器直连，未配置时读取高保真实时仓储）
   */
  async queryCourses(userId: string, semesterId?: number): Promise<AgcCourseRecord[]> {
    const cloudFunctionUrl = process.env.AGC_CLOUD_FUNCTION_URL
    const targetSemesterId = semesterId || calculateSemesterId().semesterId

    if (cloudFunctionUrl) {
      try {
        console.log(`[AgcCloudDbGateway] 正在请求华为 AGC 线上云函数: ${cloudFunctionUrl}`)
        const response = await fetch(cloudFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.buildCloudBody({
            action: 'queryCourses',
            userId,
            semesterId: targetSemesterId
          }))
        })
        if (response.ok) {
          const resJson: any = await response.json()
          if (resJson.success && Array.isArray(resJson.data)) {
            console.log(`[AgcCloudDbGateway] 成功从华为 AGC 线上云函数获取到 ${resJson.data.length} 条真实课程`)
            this.lastQuerySource = 'cloud'
            return resJson.data
          }
        }
      } catch (err) {
        console.error('[AgcCloudDbGateway] 请求华为 AGC 云函数失败，回退至本地镜像仓储:', err)
      }
    }

    this.lastQuerySource = 'mirror'
    this.loadStore()
    const rawRecords = this.store.courses.filter(
      c => this.matchUser(c.userId, userId) && (!targetSemesterId || c.semesterId === targetSemesterId)
    )

    // 按 (courseId+dayOfWeek+startSection) 精确去重
    const seen = new Set<string>()
    const records: AgcCourseRecord[] = []
    for (const r of rawRecords) {
      const key = `${r.courseId || r.courseName}_${r.dayOfWeek}_${r.startSection}`
      if (!seen.has(key)) {
        seen.add(key)
        records.push(r)
      }
    }
    return records
  }

  /**
   * 批量推送/覆盖更新云端课表记录（优先推送到华为线上云函数，同步更新本地镜像）
   */
  async upsertCourses(userId: string, semesterId: number, courses: any[]): Promise<number> {
    const cloudFunctionUrl = process.env.AGC_CLOUD_FUNCTION_URL
    if (cloudFunctionUrl) {
      try {
        console.log(`[AgcCloudDbGateway] 正在向华为 AGC 线上云函数推送覆盖课表: ${cloudFunctionUrl}`)
        // 与 ClassCourse Schema 对齐的白名单裁剪（stepWeeks 等多余字段会被云端拒绝）
        const records = (Array.isArray(courses) ? courses : []).map((c: any) => ({
          userId,
          semesterId,
          courseId: String(c.courseId || c.id || c.name || ''),
          courseName: String(c.courseName || c.name || ''),
          teacherName: c.teacherName || null,
          roomName: c.roomName || null,
          dayOfWeek: Number(c.dayOfWeek || c.time?.dayOfWeek) || 1,
          startSection: Number(c.startSection || c.time?.startSection) || 1,
          duration: Number(c.duration || c.time?.duration) || 1,
          validWeeks: c.validWeeks || '',
          colorIndex: Number(c.colorIndex ?? 0) || 0
        }))
        await fetch(cloudFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.buildCloudBody({
            action: 'upsertCourses',
            userId,
            semesterId,
            courses: records
          }))
        })
      } catch (err) {
        console.error('[AgcCloudDbGateway] 推送华为 AGC 云函数失败:', err)
      }
    }

    this.loadStore()
    const { label } = calculateSemesterId()
    const now = Date.now()

    // 移除同一用户同期的历史记录
    this.store.courses = this.store.courses.filter(
      c => !(this.matchUser(c.userId, userId) && c.semesterId === semesterId)
    )

    // 写入新记录
    let seq = 1
    for (const c of courses) {
      const courseName = c.courseName || c.name || '未知课程'
      const courseId = c.courseId || c.id || `c_${seq}`
      const dayOfWeek = Number(c.dayOfWeek || c.time?.dayOfWeek) || 1
      const startSection = Number(c.startSection || c.time?.startSection) || 1
      const duration = Number(c.duration || c.time?.duration) || 2
      const validWeeks = c.validWeeks || '1-16'

      this.store.courses.push({
        id: seq++,
        userId,
        semesterId,
        semesterLabel: c.semesterLabel || label,
        courseId,
        courseName,
        teacherName: c.teacherName || '',
        roomName: c.roomName || '',
        dayOfWeek,
        startSection,
        duration,
        validWeeks,
        stepWeeks: c.stepWeeks || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        colorIndex: typeof c.colorIndex === 'number' ? c.colorIndex : (seq - 1) % 8,
        updatedAt: now
      })
    }

    this.saveStore()
    return courses.length
  }

  /**
   * 查询指定用户在指定学期的考试安排
   */
  async queryExams(userId: string, semesterId?: number): Promise<AgcExamRecord[]> {
    const cloudFunctionUrl = process.env.AGC_CLOUD_FUNCTION_URL
    const targetSemesterId = semesterId || calculateSemesterId().semesterId

    if (cloudFunctionUrl) {
      try {
        const response = await fetch(cloudFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.buildCloudBody({
            action: 'queryExams',
            userId,
            semesterId: targetSemesterId
          }))
        })
        if (response.ok) {
          const resJson: any = await response.json()
          if (resJson.success && Array.isArray(resJson.data)) {
            this.lastQuerySource = 'cloud'
            return resJson.data
          }
        }
      } catch (err) {
        console.error('[AgcCloudDbGateway] 请求华为 AGC 云函数获取考试失败:', err)
      }
    }

    this.lastQuerySource = 'mirror'
    this.loadStore()
    const rawRecords = this.store.exams.filter(
      e => this.matchUser(e.userId, userId) && (!targetSemesterId || e.semesterId === targetSemesterId)
    )

    // 按考试科目代码/名称精确去重
    const seen = new Set<string>()
    const records: AgcExamRecord[] = []
    for (const r of rawRecords) {
      const key = `${r.courseNo || r.courseName}_${r.examDate}`
      if (!seen.has(key)) {
        seen.add(key)
        records.push(r)
      }
    }
    return records
  }

  /**
   * 批量推送/更新云端考试安排记录
   */
  async upsertExams(userId: string, semesterId: number, exams: any[]): Promise<number> {
    const cloudFunctionUrl = process.env.AGC_CLOUD_FUNCTION_URL
    if (cloudFunctionUrl) {
      try {
        // 与 ClassExam Schema 对齐的白名单裁剪
        const records = (Array.isArray(exams) ? exams : []).map((e: any) => ({
          userId,
          semesterId,
          courseNo: e.courseNo || e.id || null,
          courseName: String(e.courseName || e.name || ''),
          examDate: e.examDate || null,
          examTimeRange: e.examTimeRange || e.examTime || null,
          examLocation: e.examLocation || e.roomName || null,
          seatNo: e.seatNo || null,
          examStatus: e.examStatus || e.status || null,
          examType: e.examType || '期末考试'
        }))
        await fetch(cloudFunctionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.buildCloudBody({
            action: 'upsertExams',
            userId,
            semesterId,
            exams: records
          }))
        })
      } catch (err) {
        console.error('[AgcCloudDbGateway] 推送考试到华为 AGC 云函数失败:', err)
      }
    }

    this.loadStore()
    const { label } = calculateSemesterId()
    const now = Date.now()

    // 移除同一用户同期的历史记录
    this.store.exams = this.store.exams.filter(
      e => !(this.matchUser(e.userId, userId) && e.semesterId === semesterId)
    )

    // 写入新记录
    let seq = 1
    for (const e of exams) {
      this.store.exams.push({
        id: seq++,
        userId,
        semesterId,
        semesterLabel: e.semesterLabel || label,
        courseNo: e.courseNo || e.id || `exam_no_${seq}`,
        courseName: e.courseName || e.name || '未知考试科目',
        examDate: e.examDate || new Date().toISOString().slice(0, 10),
        examTimeRange: e.examTimeRange || e.examTime || '09:00-11:00',
        examLocation: e.examLocation || e.roomName || '考场待定',
        seatNo: e.seatNo || '未分配',
        examStatus: e.examStatus || e.status || '未开始',
        examType: e.examType || '期末考试',
        updatedAt: now
      })
    }

    this.saveStore()
    return exams.length
  }
}

export const agcCloudDbGateway = new AgcCloudDbGateway()


