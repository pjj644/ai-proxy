import fs from 'node:fs'
import path from 'node:path'

/**
 * 简单通知存储（「消息通知」功能的后端侧）。
 *
 * 自托管单实例场景：以 JSON 文件（data/notifications.json）持久化，
 * 无外部数据库依赖。记录按自增整数 id 排序，客户端以 last-seen id 做增量拉取。
 */

export interface NoticeRecord {
  id: number
  title: string
  content: string
  createdAt: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'notifications.json')
/** 最多保留的通知条数（超出时丢弃最旧的） */
const MAX_NOTICES = 50
const TITLE_MAX_LEN = 60
const CONTENT_MAX_LEN = 500

function loadNotices(): NoticeRecord[] {
  try {
    const text = fs.readFileSync(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(text) as NoticeRecord[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(n => n && typeof n.id === 'number' && typeof n.title === 'string' && typeof n.content === 'string')
  } catch {
    return []
  }
}

function saveNotices(list: NoticeRecord[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8')
}

/** 列出 id 大于 sinceId 的通知（升序）；sinceId 缺省返回全部 */
export function listNotices(sinceId = 0): NoticeRecord[] {
  return loadNotices()
    .filter(n => n.id > sinceId)
    .sort((a, b) => a.id - b.id)
}

/** 发布一条通知：id 取现有最大值 +1，落盘并返回记录 */
export function createNotice(title: string, content: string): NoticeRecord {
  const list = loadNotices()
  const maxId = list.reduce((max, n) => Math.max(max, n.id), 0)
  const record: NoticeRecord = {
    id: maxId + 1,
    title,
    content,
    createdAt: new Date().toISOString()
  }
  const next = [record, ...list].slice(0, MAX_NOTICES)
  saveNotices(next)
  return record
}

/** 删除指定通知；不存在返回 false */
export function deleteNotice(id: number): boolean {
  const list = loadNotices()
  const next = list.filter(n => n.id !== id)
  if (next.length === list.length) {
    return false
  }
  saveNotices(next)
  return true
}

/** 校验发布参数；返回错误信息，合法时返回 null */
export function validateNoticeInput(title: unknown, content: unknown): string | null {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return 'title 不能为空'
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return 'content 不能为空'
  }
  if (title.trim().length > TITLE_MAX_LEN) {
    return `title 最长 ${TITLE_MAX_LEN} 字`
  }
  if (content.trim().length > CONTENT_MAX_LEN) {
    return `content 最长 ${CONTENT_MAX_LEN} 字`
  }
  return null
}
