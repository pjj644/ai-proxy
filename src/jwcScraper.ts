import * as cheerio from 'cheerio'

export interface JwcNoticeItem {
  title: string
  date: string
  url: string
  category: string
}

export interface JwcSearchResult {
  success: boolean
  total: number
  notices: JwcNoticeItem[]
  query: string
  error?: string
}

const JWC_BASE_URL = 'https://www.jwc.uestc.edu.cn'

export async function searchJwcWebsite(keyword?: string, category: string = 'all', limit: number = 8): Promise<JwcSearchResult> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(JWC_BASE_URL, {
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
    const allNotices: JwcNoticeItem[] = []
    const seenTitles = new Set<string>()

    // 遍历所有可能的通知 a 标签
    $('a').each((_, elem) => {
      let title = $(elem).attr('title') || $(elem).text()
      title = title.replace(/\s+/g, ' ').trim()

      // 过滤非通知类的超链接
      if (!title || title.length < 4 || title === 'javascript:;' || title === '更多' || title.includes('更多>>')) {
        return
      }

      // 判断是否含有成电教务处典型的分类前缀或通知关键词
      const isNotice = title.startsWith('【') || 
                       title.includes('通知') || 
                       title.includes('公告') || 
                       title.includes('安排') || 
                       title.includes('公示') || 
                       title.includes('名单') ||
                       title.includes('选课') ||
                       title.includes('考试') ||
                       title.includes('申报')

      if (!isNotice || seenTitles.has(title)) {
        return
      }

      // 提取分类
      let itemCategory = '教务通知'
      const catMatch = title.match(/【(.*?)】/)
      if (catMatch) {
        itemCategory = catMatch[1]
      }

      // 提取日期：查找兄弟节点或父级内部的 <i>、<span>、.date、.time
      let date = ''
      const parent = $(elem).parent()
      const dateElem = parent.find('i, span, .date, .time, em')
      dateElem.each((_, d) => {
        const t = $(d).text().trim()
        if (/^\d{1,2}-\d{1,2}$|^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
          date = t
        }
      })

      if (!date) {
        date = '近期'
      }

      // 提取详情链接
      let href = $(elem).attr('href') || ''
      let fullUrl = JWC_BASE_URL
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        fullUrl = href.startsWith('http') ? href : `${JWC_BASE_URL}/${href.replace(/^\//, '')}`
      }

      seenTitles.add(title)
      allNotices.push({
        title,
        date,
        url: fullUrl,
        category: itemCategory,
      })
    })

    // 根据关键词和分类进行匹配与过滤
    let filtered = allNotices

    if (category && category !== 'all') {
      filtered = filtered.filter(n => n.category.includes(category) || category.includes(n.category))
    }

    if (keyword && keyword.trim().length > 0) {
      const q = keyword.trim().toLowerCase()
      const tokens = q.split(/[\s,，、+&|/._\-!！?？]+/).filter(t => t.length > 0)

      const scored = filtered.map(item => {
        let score = 0
        const tLower = item.title.toLowerCase()
        if (tLower.includes(q)) score += 30
        for (const tok of tokens) {
          if (tLower.includes(tok)) score += 10
        }
        if (item.category.toLowerCase().includes(q)) score += 5
        return { item, score }
      })

      filtered = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.item)

      // 如果完全没匹配到，退回到全部最新通知
      if (filtered.length === 0) {
        filtered = allNotices.slice(0, limit)
      }
    }

    return {
      success: true,
      total: filtered.length,
      notices: filtered.slice(0, limit),
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
