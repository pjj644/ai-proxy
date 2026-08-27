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
  dayOfWeek: number      // 1-7
  startSection: number   // 1-12
  duration: number       // 持续节数
  validWeeks: string     // 如 "1-16周"
  colorIndex?: number
}

export interface JwcExamItem {
  id: string
  courseName: string
  examDate: string
  examTime: string
  roomName: string
  seatNo: string
  status: string
}

export interface JwcSyncResult<T> {
  success: boolean
  code: 'SUCCESS' | 'INVALID_CREDENTIALS' | 'MFA_REQUIRED' | 'NETWORK_ERROR' | 'PARSE_ERROR'
  message: string
  data?: T
  semesterLabel?: string
}

// AES-128-CFB for UESTC WebVPN
class WebvpnHelper {
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
class CookieJar {
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
 * 解析课表 HTML 中的 TaskActivity 或表格数据
 */
export function parseCoursesFromHtml(html: string): JwcCourseItem[] {
  const courses: JwcCourseItem[] = []
  
  // 1. 尝试从 script 内提取 TaskActivity 声明:
  // new TaskActivity(teacherId, teacherName, courseId, courseName, roomId, roomName, validWeeks, ...)
  // var act = new TaskActivity("...", "李老师", "...", "高等数学", "...", "品学楼B101", "1-16周");
  // table0.activities[day][section] = ...
  const taskActivityRegex = /new\s+TaskActivity\s*\(([^)]+)\)/g
  let match: RegExpExecArray | null
  
  while ((match = taskActivityRegex.exec(html)) !== null) {
    try {
      const argsRaw = match[1]
      // 简单按逗号分割（处理引号字符串）
      const args = argsRaw.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      if (args.length >= 7) {
        const teacherName = args[1] || ''
        const courseId = args[2] || `c_${courses.length + 1}`
        const courseName = args[3] || ''
        const roomName = args[5] || ''
        const validWeeks = args[6] || ''
        
        if (courseName) {
          // 查找该 activity 放置的单元格索引（在附近代码中）
          const tail = html.slice(match.index, match.index + 200)
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
            duration: 2, // 默认 2 节连上
            validWeeks: validWeeks || '1-16周'
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
        if (text && text.length > 5 && !text.includes('星期') && !text.includes('节次')) {
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
          if (lines.length >= 2) {
            courses.push({
              id: `c_${rowIdx}_${colIdx}`,
              name: lines[0],
              teacherName: lines[1] || '',
              roomName: lines[2] || '',
              dayOfWeek: (colIdx % 7) + 1,
              startSection: rowIdx + 1,
              duration: 1,
              validWeeks: '1-16周'
            })
          }
        }
      })
    })
  }

  return courses
}

/**
 * 教务抓取中转服务类
 */
export class JwcAuthProxy {
  static async fetchCourses(creds: JwcAuthCredentials): Promise<JwcSyncResult<JwcCourseItem[]>> {
    const { username, password } = creds
    if (!username || !password) {
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: '学号或密码不能为空'
      }
    }

    try {
      const jar = new CookieJar()
      
      // 优先通过 WebVPN 统一入口访问
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
          success: false,
          code: 'INVALID_CREDENTIALS',
          message: '学号或密码错误，请检查输入'
        }
      }

      if (nextUrl.includes('reAuthCheck') || nextUrl.includes('isMultifactor=true')) {
        return {
          success: false,
          code: 'MFA_REQUIRED',
          message: '检测到您的成电账号开启了多因子（MFA）校验或非可信设备限制，建议在成电信息门户取消或直接使用课表导入/样例展示。'
        }
      }

      // 跟随跳转进入 EAMS
      while (nextUrl) {
        let fetchUrl = nextUrl
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

      // 请求课表页面
      const vpnCourseUrl = WebvpnHelper.buildVpnUrl('eams.uestc.edu.cn', '/eams/courseTableForStd.action')
      const courseRes = await fetch(vpnCourseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': jar.getCookieHeader()
        }
      })
      jar.setCookiesFromHeaders(courseRes.headers)
      const courseHtml = await courseRes.text()
      const courses = parseCoursesFromHtml(courseHtml)

      return {
        success: true,
        code: 'SUCCESS',
        message: `成功抓取到 ${courses.length} 门课程`,
        data: courses,
        semesterLabel: '2026-2027学年 第一学期'
      }
    } catch (err: unknown) {
      console.error('[JwcAuthProxy] Error during sync:', err)
      return {
        success: false,
        code: 'NETWORK_ERROR',
        message: `教务网络连接异常: ${(err as Error)?.message || String(err)}`
      }
    }
  }
}
