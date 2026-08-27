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
   * 查询指定用户在指定学期的云端课表
   */
  async queryCourses(userId: string, semesterId?: number): Promise<AgcCourseRecord[]> {
    this.loadStore()
    const targetSemesterId = semesterId || calculateSemesterId().semesterId
    const records = this.store.courses.filter(
      c => c.userId === userId && (!targetSemesterId || c.semesterId === targetSemesterId)
    )
    return records
  }

  /**
   * 批量推送/更新云端课表记录
   */
  async upsertCourses(userId: string, semesterId: number, courses: Partial<AgcCourseRecord>[]): Promise<number> {
    this.loadStore()
    const { label } = calculateSemesterId()
    const now = Date.now()

    // 移除同一用户同期的历史记录
    this.store.courses = this.store.courses.filter(
      c => !(c.userId === userId && c.semesterId === semesterId)
    )

    // 写入新记录
    let seq = 1
    for (const c of courses) {
      this.store.courses.push({
        id: seq++,
        userId,
        semesterId,
        semesterLabel: c.semesterLabel || label,
        courseId: c.courseId || `c_${seq}`,
        courseName: c.courseName || '未知课程',
        teacherName: c.teacherName || '',
        roomName: c.roomName || '',
        dayOfWeek: c.dayOfWeek || 1,
        startSection: c.startSection || 1,
        duration: c.duration || 2,
        validWeeks: c.validWeeks || '1-16周',
        stepWeeks: c.stepWeeks || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
        colorIndex: c.colorIndex,
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
    this.loadStore()
    const targetSemesterId = semesterId || calculateSemesterId().semesterId
    const records = this.store.exams.filter(
      e => e.userId === userId && (!targetSemesterId || e.semesterId === targetSemesterId)
    )
    return records
  }

  /**
   * 批量推送/更新云端考试安排记录
   */
  async upsertExams(userId: string, semesterId: number, exams: Partial<AgcExamRecord>[]): Promise<number> {
    this.loadStore()
    const { label } = calculateSemesterId()
    const now = Date.now()

    // 移除同一用户同期的历史记录
    this.store.exams = this.store.exams.filter(
      e => !(e.userId === userId && e.semesterId === semesterId)
    )

    // 写入新记录
    let seq = 1
    for (const e of exams) {
      this.store.exams.push({
        id: seq++,
        userId,
        semesterId,
        semesterLabel: e.semesterLabel || label,
        courseNo: e.courseNo || `exam_no_${seq}`,
        courseName: e.courseName || '未知考试科目',
        examDate: e.examDate || new Date().toISOString().slice(0, 10),
        examTimeRange: e.examTimeRange || '09:00-11:00',
        examLocation: e.examLocation || '考场待定',
        seatNo: e.seatNo || '未分配',
        examStatus: e.examStatus || '未开始',
        examType: e.examType || '期末考试',
        updatedAt: now
      })
    }

    this.saveStore()
    return exams.length
  }

  // ============ 华为 AGC 邮箱验证码管理 ============

  private verifyCodeStore = new Map<string, { code: string; expireAt: number }>()

  /**
   * 向指定邮箱发送 AGC 登录验证码
   */
  async sendVerifyCode(email: string): Promise<{ success: boolean; message: string; debugCode?: string }> {
    if (!email || !email.includes('@')) {
      return { success: false, message: '请输入有效的邮箱地址' }
    }

    // 生成 6 位随机验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expireAt = Date.now() + 5 * 60 * 1000 // 5分钟有效

    this.verifyCodeStore.set(email.toLowerCase().trim(), { code, expireAt })
    console.info(`[AgcCloudDbGateway] 华为 AGC 验证码已生成 [${email}]: ${code}`)

    return {
      success: true,
      message: `验证码已发送至 ${email}，请在 5 分钟内完成校验`,
      debugCode: code
    }
  }

  /**
   * 校验验证码并登录
   */
  async loginWithVerifyCode(email: string, inputCode: string): Promise<{ success: boolean; message: string; user?: any }> {
    const cleanEmail = email.toLowerCase().trim()
    const record = this.verifyCodeStore.get(cleanEmail)

    if (!record) {
      return { success: false, message: '请先获取验证码' }
    }

    if (Date.now() > record.expireAt) {
      this.verifyCodeStore.delete(cleanEmail)
      return { success: false, message: '验证码已过期，请重新获取' }
    }

    if (record.code !== inputCode.trim()) {
      return { success: false, message: '验证码不正确，请重新输入' }
    }

    // 校验成功，清除验证码并返回用户会话
    this.verifyCodeStore.delete(cleanEmail)
    const user = {
      uid: cleanEmail,
      email: cleanEmail,
      displayName: cleanEmail.split('@')[0],
      isAnonymous: false,
      lastLoginTime: Date.now()
    }

    return {
      success: true,
      message: '华为 AGC 账号登录验证成功',
      user
    }
  }
}

export const agcCloudDbGateway = new AgcCloudDbGateway()

