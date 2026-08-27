import fs from 'fs'
import crypto from 'crypto'
import * as cheerio from 'cheerio'

const tempEnvPath = 'D:\\harmony\\helper_app\\temp\\.env'
let username = ''
let password = ''

try {
  const content = fs.readFileSync(tempEnvPath, 'utf-8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('account:')) {
      username = trimmed.substring('account:'.length).trim()
    } else if (trimmed.startsWith('password:')) {
      password = trimmed.substring('password:'.length).trim()
    }
  }
} catch (e) {
  console.error('Failed to read temp .env:', e)
}

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

class CookieJar {
  cookies: Map<string, string> = new Map()

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

async function inspectReAuthPage() {
  const jar = new CookieJar()
  const initRes = await fetch('https://webvpn.uestc.edu.cn', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    redirect: 'follow'
  })
  jar.setCookiesFromHeaders(initRes.headers)
  const initHtml = await initRes.text()
  const $ = cheerio.load(initHtml)
  
  const salt = $('#pwdEncryptSalt').val() as string || ''
  const execution = $('form#pwdFromId input[name="execution"]').val() as string || 'e1s1'
  const action = $('form#pwdFromId').attr('action') || '/authserver/login'
  const postUrl = action.startsWith('http') ? action : `https://webvpn.uestc.edu.cn${action.startsWith('/') ? '' : '/'}${action}?service=${encodeURIComponent('https://webvpn.uestc.edu.cn/login?cas_login=true')}`
  
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
  const loc = postRes.headers.get('location') || ''
  
  const stepRes = await fetch(loc, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cookie': jar.getCookieHeader()
    }
  })
  jar.setCookiesFromHeaders(stepRes.headers)
  const stepHtml = await stepRes.text()
  const $step = cheerio.load(stepHtml)
  console.log('[reAuth title]:', $step('title').text())
  console.log('[reAuth body snippet]:', $step('body').text().replace(/\s+/g, ' ').slice(0, 500))
  $step('form').each((i, f) => {
    console.log(`reAuth Form ${i} action="${$step(f).attr('action')}" id="${$step(f).attr('id')}"`)
    $step(f).find('input').each((_, inp) => {
      console.log(`  inp name="${$step(inp).attr('name')}" id="${$step(inp).attr('id')}" val="${$step(inp).attr('value') || ''}"`)
    })
  })
}

inspectReAuthPage()
