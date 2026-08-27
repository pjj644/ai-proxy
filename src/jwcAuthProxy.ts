import crypto from 'crypto'
import * as cheerio from 'cheerio'

export interface JwcAuthCredentials {
  username: string
  password: string
}

export interface JwcCourseItem {
  id: string
  name: string
  teacherName: string
  roomName: string
  dayOfWeek: number      // 1-7 (周一到周日)
  startSection: number   // 1-12
  duration: number       // 持续节数
  validWeeks: string     // 如 "1-16周"
  colorIndex?: number
  stepWeeks?: number[]
}

export interface JwcExamItem {
  id: string
  courseName: string
  examDate: string       // YYYY-MM-DD
  examTime: string       // HH:MM-HH:MM
  roomName: string
  seatNo: string
  status: string
}

export interface JwcFullData {
  courses: JwcCourseItem[]
  exams: JwcExamItem[]
}

export interface JwcSyncResult<T> {
  success: boolean
  code: 'SUCCESS' | 'INVALID_CREDENTIALS' | 'MFA_REQUIRED' | 'NETWORK_ERROR' | 'PARSE_ERROR'
  message: string
  data?: T
  semesterId?: number
  semesterLabel?: string
}

// 动态学期计算基准（base 503 代表 2025-2026 学年第二学期，每学期步长 20）
const BASE_SEMESTER_ID = 503
const BASE_ACADEMIC_START_YEAR = 2025
const BASE_TERM_NUMBER = 2
const SEMESTER_ID_STEP = 20

export function calculateSemesterId(date: Date = new Date()): { semesterId: number; label: string } {
  const month = date.getMonth() + 1
  const year = date.getFullYear()

  let startYear = year
  let termNumber = 1

  if (month >= 2 && month <= 7) {
    startYear = year - 1
    termNumber = 2
  } else if (month >= 8) {
    startYear = year
    termNumber = 1
  } else {
    startYear = year - 1
    termNumber = 1
  }

  const targetIndex = startYear * 2 + (termNumber - 1)
  const baseIndex = BASE_ACADEMIC_START_YEAR * 2 + (BASE_TERM_NUMBER - 1)
  const semesterId = BASE_SEMESTER_ID + (targetIndex - baseIndex) * SEMESTER_ID_STEP
  const termLabel = termNumber === 1 ? '第一学期' : '第二学期'
  const label = `${startYear}-${startYear + 1}学年 ${termLabel}`

  return { semesterId, label }
}

// AES-128-CFB for UESTC WebVPN
export class WebvpnHelper {
  private static readonly VPN_KEY = Buffer.from('wrdvpnisthebest!', 'utf8')
  private static readonly VPN_IV = Buffer.from('wrdvpnisthebest!', 'utf8')

  static encodeHost(host: string): string {
    const segmentSize = 16
    const appendLength = segmentSize - (host.length % segmentSize)
    const paddedHost = host.padEnd(host.length + appendLength, '0')
    const plaintext = Buffer.from(paddedHost, 'utf8')

    const cipher = crypto.createCipheriv('aes-128-cfb', WebvpnHelper.VPN_KEY, WebvpnHelper.VPN_IV)
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const ivHex = WebvpnHelper.VPN_IV.toString('hex')
    const encHex = encrypted.toString('hex')
    return ivHex + encHex.slice(0, host.length * 2)
  }

  static buildVpnUrl(host: string, path: string = '', protocol: string = 'https'): string {
    return `https://webvpn.uestc.edu.cn/${protocol}/${WebvpnHelper.encodeHost(host)}${path}`
  }
}

// Wisedu CAS Password Encryption
function encryptCasPassword(pwd: string, salt: string): string {
  if (!salt) return pwd
  const chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678'
  let random64 = ''
  for (let i = 0; i < 64; i++) random64 += chars.charAt(Math.floor(Math.random() * chars.length))
  let ivStr = ''
  for (let i = 0; i < 16; i++) ivStr += chars.charAt(Math.floor(Math.random() * chars.length))
  
  const key = Buffer.from(salt.trim(), 'utf8')
  const iv = Buffer.from(ivStr, 'utf8')
  const plaintext = Buffer.from(random64 + pwd, 'utf8')
  
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return encrypted.toString('base64')
}

// Cookie Jar for session tracking
export class CookieJar {
  private cookies: Map<string, string> = new Map()

  setCookiesFromHeaders(headers: Headers) {
    let rawCookies: string[] = []
    if (typeof (headers as any).getSetCookie === 'function') {
      rawCookies = (headers as any).getSetCookie()
    } else {
      const single = headers.get('set-cookie')
      if (single) rawCookies = [single]
    }
    for (const raw of rawCookies) {
      if (!raw) continue
      const parts = raw.split(';')
      const first = parts[0].trim()
      const eqIdx = first.indexOf('=')
      if (eqIdx !== -1) {
        const k = first.slice(0, eqIdx).trim()
        const v = first.slice(eqIdx + 1).trim()
        this.cookies.set(k, v)
      }
    }
  }

  getCookieHeader(): string {
    const list: string[] = []
    for (const [k, v] of this.cookies.entries()) {
      list.push(`${k}=${v}`)
    }
    return list.join('; ')
  }
}

/**
 * 解析周次字符串，生成周次数字数组，例如 "1-16周" => [1,2,...,16]
 */
function parseWeeksToArray(validWeeks: string): number[] {
  const weeks: number[] = []
  if (!validWeeks) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  
  const clean = validWeeks.replace(/周/g, '')
  const parts = clean.split(',')
  for (const part of parts) {
    const range = part.split('-')
    if (range.length === 2) {
      const start = parseInt(range[0], 10)
      const end = parseInt(range[1], 10)
      if (!isNaN(start) && !isNaN(end)) {
        const isSingle = part.includes('单')
        const isDouble = part.includes('双')
        for (let w = start; w <= end; w++) {
          if (isSingle && w % 2 === 0) continue
          if (isDouble && w % 2 !== 0) continue
          weeks.push(w)
        }
      }
    } else if (range.length === 1) {
      const w = parseInt(range[0], 10)
      if (!isNaN(w)) weeks.push(w)
    }
  }
  return weeks.length > 0 ? weeks : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
}

/**
 * 解析课表 HTML 中的 TaskActivity 或表格数据
 */
export function parseCoursesFromHtml(html: string): JwcCourseItem[] {
  const courses: JwcCourseItem[] = []
  
  // 1. 优先从 script 内提取 TaskActivity 声明:
  // new TaskActivity(teacherId, teacherName, courseId, courseName, roomId, roomName, validWeeks, ...)
  const taskActivityRegex = /new\s+TaskActivity\s*\(([^)]+)\)/g
  let match: RegExpExecArray | null
  
  while ((match = taskActivityRegex.exec(html)) !== null) {
    try {
      const argsRaw = match[1]
      const args = argsRaw.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      if (args.length >= 7) {
        const teacherName = args[1] || ''
        const courseId = args[2] || `c_${courses.length + 1}`
        const courseName = args[3] || ''
        const roomName = args[5] || ''
        const validWeeks = args[6] || '1-16周'
        
        if (courseName) {
          const tail = html.slice(match.index, match.index + 250)
          const indexMatch = tail.match(/activities\[(\d+)\]\[(\d+)\]/)
          const dayOfWeek = indexMatch ? parseInt(indexMatch[1], 10) + 1 : 1
          const startSection = indexMatch ? parseInt(indexMatch[2], 10) + 1 : 1

          courses.push({
            id: courseId,
            name: courseName,
            teacherName,
            roomName,
            dayOfWeek,
            startSection,
            duration: 2,
            validWeeks,
            stepWeeks: parseWeeksToArray(validWeeks)
          })
        }
      }
    } catch (e) {
      // ignore item parse error
    }
  }

  // 2. 备选方案：解析 HTML table.gridtable 或课表格子
  if (courses.length === 0) {
    const $ = cheerio.load(html)
    $('table tr').each((rowIdx, row) => {
      $(row).find('td').each((colIdx, cell) => {
        const text = $(cell).text().trim()
        if (text && text.length > 4 && !text.includes('星期') && !text.includes('节次')) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
          if (lines.length >= 2) {
            courses.push({
              id: `c_${rowIdx}_${colIdx}`,
              name: lines[0],
              teacherName: lines[1] || '',
              roomName: lines[2] || '',
              dayOfWeek: (colIdx % 7) + 1,
              startSection: rowIdx + 1,
              duration: 2,
              validWeeks: '1-16周',
              stepWeeks: parseWeeksToArray('1-16周')
            })
          }
        }
      })
    })
  }

  return courses
}

/**
 * 解析考试安排 HTML
 */
export function parseExamsFromHtml(html: string): JwcExamItem[] {
  const exams: JwcExamItem[] = []
  const $ = cheerio.load(html)

  $('table.gridtable tr, table.grid tr, table tr').each((idx, row) => {
    if (idx === 0) return // Skip header
    const cells = $(row).find('td')
    if (cells.length >= 5) {
      const texts: string[] = []
      cells.each((_, cell) => {
        texts.push($(cell).text().trim())
      })

      // Standard EAMS Exam columns:
      // [0] 序号/学期, [1] 课程代码/名称, [2] 考试类别, [3] 考试时间, [4] 考场, [5] 座位号, [6] 状态
      const courseName = texts[1] || texts[0]
      const examTimeRaw = texts[3] || texts[2] || ''
      const roomName = texts[4] || texts[3] || '考场待定'
      const seatNo = texts[5] || '未分配'
      const status = texts[6] || texts[4] || '未开始'

      if (courseName && courseName.length > 1 && !courseName.includes('课程')) {
        // Extract Date and Time from examTimeRaw e.g. "2026-09-18 09:00-11:00"
        let examDate = ''
        let examTime = ''
        const dateMatch = examTimeRaw.match(/(\d{4}-\d{2}-\d{2})/)
        if (dateMatch) {
          examDate = dateMatch[1]
          examTime = examTimeRaw.replace(examDate, '').trim()
        } else {
          examDate = new Date().toISOString().slice(0, 10)
          examTime = examTimeRaw || '09:00-11:00'
        }

        exams.push({
          id: `exam_${idx}`,
          courseName,
          examDate,
          examTime,
          roomName,
          seatNo: seatNo.includes('号') ? seatNo : `${seatNo}号`,
          status: status.includes('结束') ? '已结束' : status.includes('进行') ? '进行中' : '未开始'
        })
      }
    }
  })

  return exams
}

/**
 * 教务抓取与会话管理中转服务
 */
export class JwcAuthProxy {
  /**
   * 登录 WebVPN + CAS 并获取 CookieJar 会话
   */
  private static async login(creds: JwcAuthCredentials): Promise<{ jar: CookieJar } | { error: JwcSyncResult<never> }> {
    const { username, password } = creds
    if (!username || !password) {
      return {
        error: {
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: '学号或密码不能为空'
        }
      }
    }

    try {
      const jar = new CookieJar()
      
      const initRes = await fetch('https://webvpn.uestc.edu.cn', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        redirect: 'follow'
      })
      jar.setCookiesFromHeaders(initRes.headers)
      
      const initHtml = await initRes.text()
      const $ = cheerio.load(initHtml)
      const salt = $('#pwdEncryptSalt').val() as string || ''
      const execution = $('form#pwdFromId input[name="execution"]').val() as string || 'e1s1'
      const action = $('form#pwdFromId').attr('action') || '/authserver/login'
      const postUrl = action.startsWith('http')
        ? action
        : `https://webvpn.uestc.edu.cn${action.startsWith('/') ? '' : '/'}${action}?service=${encodeURIComponent('https://webvpn.uestc.edu.cn/login?cas_login=true')}`

      const formParams = new URLSearchParams()
      formParams.append('username', username)
      formParams.append('password', encryptCasPassword(password, salt))
      formParams.append('cllt', 'userNameLogin')
      formParams.append('dllt', 'generalLogin')
      formParams.append('lt', '')
      formParams.append('execution', execution)
      formParams.append('_eventId', 'submit')
      formParams.append('rmShown', '1')

      const postRes = await fetch(postUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://webvpn.uestc.edu.cn',
          'Referer': initRes.url,
          'Cookie': jar.getCookieHeader()
        },
        body: formParams.toString(),
        redirect: 'manual'
      })
      jar.setCookiesFromHeaders(postRes.headers)

      let nextUrl = postRes.headers.get('location')
      if (!nextUrl) {
        return {
          error: {
            success: false,
            code: 'INVALID_CREDENTIALS',
            message: '学号或密码错误，请检查输入'
          }
        }
      }

      if (nextUrl.includes('reAuthCheck') || nextUrl.includes('isMultifactor=true')) {
        return {
          error: {
            success: false,
            code: 'MFA_REQUIRED',
            message: '检测到您的成电账号开启了多因子（MFA）校验或非可信设备限制，建议在成电信息门户取消或直接使用华为云端同步。'
          }
        }
      }

      // 跟随跳转进入 EAMS
      while (nextUrl) {
        let fetchUrl: string = nextUrl
        if (!fetchUrl.startsWith('http')) {
          fetchUrl = `https://webvpn.uestc.edu.cn${fetchUrl.startsWith('/') ? '' : '/'}${fetchUrl}`
        }
        const stepRes: globalThis.Response = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': jar.getCookieHeader()
          },
          redirect: 'manual'
        })
        jar.setCookiesFromHeaders(stepRes.headers)
        nextUrl = stepRes.headers.get('location')
      }

      return { jar }
    } catch (err: unknown) {
      console.error('[JwcAuthProxy] Login error:', err)
      return {
        error: {
          success: false,
          code: 'NETWORK_ERROR',
          message: `教务认证网络异常: ${(err as Error)?.message || String(err)}`
        }
      }
    }
  }

  /**
   * 抓取课表数据
   */
  static async fetchCourses(creds: JwcAuthCredentials, requestedSemesterId?: number): Promise<JwcSyncResult<JwcCourseItem[]>> {
    const { semesterId, label } = calculateSemesterId()
    const finalSemesterId = requestedSemesterId || semesterId

    const loginRes = await JwcAuthProxy.login(creds)
    if ('error' in loginRes) {
      return loginRes.error
    }

    try {
      const vpnCourseUrl = WebvpnHelper.buildVpnUrl(
        'eams.uestc.edu.cn',
        `/eams/courseTableForStd.action?semester.id=${finalSemesterId}`
      )
      const courseRes = await fetch(vpnCourseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': loginRes.jar.getCookieHeader()
        }
      })
      loginRes.jar.setCookiesFromHeaders(courseRes.headers)
      const courseHtml = await courseRes.text()
      const courses = parseCoursesFromHtml(courseHtml)

      return {
        success: true,
        code: 'SUCCESS',
        message: `成功抓取到 ${courses.length} 门课程`,
        data: courses,
        semesterId: finalSemesterId,
        semesterLabel: label
      }
    } catch (err: unknown) {
      console.error('[JwcAuthProxy] fetchCourses error:', err)
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: `抓取课表网络异常: ${(err as Error)?.message || String(err)}`
      }
    }
  }

  /**
   * 抓取考试排期数据
   */
  static async fetchExams(creds: JwcAuthCredentials, requestedSemesterId?: number): Promise<JwcSyncResult<JwcExamItem[]>> {
    const { semesterId, label } = calculateSemesterId()
    const finalSemesterId = requestedSemesterId || semesterId

    const loginRes = await JwcAuthProxy.login(creds)
    if ('error' in loginRes) {
      return loginRes.error
    }

    try {
      const vpnExamUrl = WebvpnHelper.buildVpnUrl(
        'eams.uestc.edu.cn',
        `/eams/examTableForStd.action?semester.id=${finalSemesterId}`
      )
      const examRes = await fetch(vpnExamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': loginRes.jar.getCookieHeader()
        }
      })
      loginRes.jar.setCookiesFromHeaders(examRes.headers)
      const examHtml = await examRes.text()
      const exams = parseExamsFromHtml(examHtml)

      return {
        success: true,
        code: 'SUCCESS',
        message: `成功抓取到 ${exams.length} 门考试排期`,
        data: exams,
        semesterId: finalSemesterId,
        semesterLabel: label
      }
    } catch (err: unknown) {
      console.error('[JwcAuthProxy] fetchExams error:', err)
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: `抓取考试排期异常: ${(err as Error)?.message || String(err)}`
      }
    }
  }

  /**
   * 单次会话抓取课表与考试全量数据
   */
  static async fetchFullData(creds: JwcAuthCredentials, requestedSemesterId?: number): Promise<JwcSyncResult<JwcFullData>> {
    const { semesterId, label } = calculateSemesterId()
    const finalSemesterId = requestedSemesterId || semesterId

    const loginRes = await JwcAuthProxy.login(creds)
    if ('error' in loginRes) {
      return loginRes.error
    }

    try {
      const cookieHeader = loginRes.jar.getCookieHeader()

      // 1. Fetch Courses
      const vpnCourseUrl = WebvpnHelper.buildVpnUrl(
        'eams.uestc.edu.cn',
        `/eams/courseTableForStd.action?semester.id=${finalSemesterId}`
      )
      const courseRes = await fetch(vpnCourseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': cookieHeader
        }
      })
      const courseHtml = await courseRes.text()
      const courses = parseCoursesFromHtml(courseHtml)

      // 2. Fetch Exams
      const vpnExamUrl = WebvpnHelper.buildVpnUrl(
        'eams.uestc.edu.cn',
        `/eams/examTableForStd.action?semester.id=${finalSemesterId}`
      )
      const examRes = await fetch(vpnExamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': cookieHeader
        }
      })
      const examHtml = await examRes.text()
      const exams = parseExamsFromHtml(examHtml)

      return {
        success: true,
        code: 'SUCCESS',
        message: `成功抓取到 ${courses.length} 门课程和 ${exams.length} 门考试`,
        data: {
          courses,
          exams
        },
        semesterId: finalSemesterId,
        semesterLabel: label
      }
    } catch (err: unknown) {
      console.error('[JwcAuthProxy] fetchFullData error:', err)
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: `教务全量抓取异常: ${(err as Error)?.message || String(err)}`
      }
    }
  }
}
