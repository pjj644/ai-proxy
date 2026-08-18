import * as cheerio from 'cheerio'

export interface JwcNoticeItem {
  title: string
  date: string
  url: string
  category?: string
  summary?: string
}

export interface JwcSearchResult {
  success: boolean
  total: number
  notices: JwcNoticeItem[]
  query: string
  error?: string
}

const JWC_BASE_URL = 'https://www.jwc.uestc.edu.cn'

const CATEGORY_MAP: Record<string, string> = {
  all: `${JWC_BASE_URL}/tzgg/qb.htm`,
  jxtz: `${JWC_BASE_URL}/tzgg/jxtz.htm`,
  kwtz: `${JWC_BASE_URL}/tzgg/kwtz.htm`,
  sjjx: `${JWC_BASE_URL}/tzgg/sjjx.htm`,
  xjgl: `${JWC_BASE_URL}/tzgg/xjgl.htm`,
}

export async function searchJwcWebsite(keyword?: string, category: string = 'all', limit: number = 6): Promise<JwcSearchResult> {
  const targetUrl = CATEGORY_MAP[category] || CATEGORY_MAP.all

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`教务处服务器响应异常: HTTP ${response.status}`)
    }

    const html = await response.text()
    const $ = cheerio.load(html)
    const items: JwcNoticeItem[] = []

    // 成电教务处常见列表选择器（兼容列表页 li / tr / .list-item 结构）
    $('ul.list-gl li, .list-box li, .news_list li, .tzgg-list li, ul.list li').each((_, elem) => {
      const aTag = $(elem).find('a')
      let title = aTag.attr('title') || aTag.text()
      title = title.replace(/\s+/g, ' ').trim()

      const rawHref = aTag.attr('href') || ''
      if (!title || !rawHref) return

      // 解析完整 URL
      let fullUrl = rawHref
      if (!rawHref.startsWith('http')) {
        if (rawHref.startsWith('../')) {
          fullUrl = `${JWC_BASE_URL}/${rawHref.replace(/^(\.\.\/)+/, '')}`
        } else if (rawHref.startsWith('/')) {
          fullUrl = `${JWC_BASE_URL}${rawHref}`
        } else {
          fullUrl = `${JWC_BASE_URL}/tzgg/${rawHref}`
        }
      }

      // 提取日期（通常在 span 或 em 中，如 2026-08-18 或 08-18）
      const dateText = $(elem).find('.date, .time, span, em').last().text().trim()
      const dateMatch = dateText.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}/)
      const date = dateMatch ? dateMatch[0] : (dateText || '近期')

      // 过滤关键词
      if (keyword && keyword.trim().length > 0) {
        const q = keyword.trim().toLowerCase()
        if (!title.toLowerCase().includes(q)) {
          return
        }
      }

      items.push({
        title,
        date,
        url: fullUrl,
        category: category !== 'all' ? category : '教务通知',
      })
    })

    // 如果指定关键词没有严格匹配到，做分词后宽泛匹配
    if (keyword && keyword.trim().length > 0 && items.length === 0) {
      const tokens = keyword.trim().split(/\s+/).filter(t => t.length > 0)
      $('ul.list-gl li, .list-box li, .news_list li, .tzgg-list li, ul.list li').each((_, elem) => {
        const aTag = $(elem).find('a')
        let title = (aTag.attr('title') || aTag.text()).replace(/\s+/g, ' ').trim()
        const rawHref = aTag.attr('href') || ''
        if (!title || !rawHref) return

        if (tokens.some(token => title.includes(token))) {
          let fullUrl = rawHref
          if (!rawHref.startsWith('http')) {
            fullUrl = rawHref.startsWith('/') ? `${JWC_BASE_URL}${rawHref}` : `${JWC_BASE_URL}/tzgg/${rawHref}`
          }
          const dateText = $(elem).find('.date, .time, span, em').last().text().trim()
          items.push({
            title,
            date: dateText || '近期',
            url: fullUrl,
            category: '教务通知',
          })
        }
      })
    }

    return {
      success: true,
      total: items.length,
      notices: items.slice(0, limit),
      query: keyword || '全部最新通知',
    }
  } catch (err: unknown) {
    console.error('[JwcScraper] error:', err)
    return {
      success: false,
      total: 0,
      notices: [],
      query: keyword || '',
      error: String((err as Error)?.message || err),
    }
  }
}
