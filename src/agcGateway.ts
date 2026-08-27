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
}

export const agcCloudDbGateway = new AgcCloudDbGateway()
