import * as cheerio from 'cheerio'

export interface JwcNoticeItem {
  title: string
  date: string
  url: string
  category: string
  newsId?: string
  snippet?: string
}

export interface JwcSearchResult {
  success: boolean
  total: number
  notices: JwcNoticeItem[]
  query: string
  source: 'official_search' | 'homepage_feed'
  error?: string
}

const JWC_BASE_URL = 'https://www.jwc.uestc.edu.cn'

/**
 * 抓取单篇教务处通知的正文核心摘要
 */
async function fetchArticleSnippet(newsId: string): Promise<string> {
  try {
    const detailUrl = `${JWC_BASE_URL}/info/${newsId}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 4000)

    const res = await fetch(detailUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    clearTimeout(timeoutId)

    if (!res.ok) return ''
    const html = await res.text()
    const $ = cheerio.load(html)

    // 查找正文段落
    let snippet = ''
    $('div, p').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim()
      if (
        text.length > 40 &&
        text.length < 600 &&
        !text.includes('DOCTYPE') &&
        !text.includes('您现在的位置') &&
        !text.includes('沙河校区地址') &&
        (text.includes('根据') || text.includes('通知') || text.includes('安排') || text.includes('时间') || text.includes('规定') || text.includes('报名'))
      ) {
        if (!snippet || text.length > snippet.length) {
          snippet = text
        }
      }
    })

    return snippet.slice(0, 300)
  } catch (e) {
    return ''
  }
}

/**
 * 方案核心：通过成电教务处官网右上角 POST 搜索表单检索全量历史与即时通知
 */
export async function searchJwcWebsite(keyword?: string, category: string = 'all', limit: number = 6): Promise<JwcSearchResult> {
  const query = (keyword || '').trim()

  // 1. 如果提供了关键词，优先使用教务处官网右上角的官方搜索服务检索全库
  if (query.length > 0) {
    try {
      // Step A: 访问首页获取 JSession 与 Search Form Action
      const homeController = new AbortController()
      const homeTimeout = setTimeout(() => homeController.abort(), 6000)

      const homeRes = await fetch(JWC_BASE_URL, {
        signal: homeController.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      clearTimeout(homeTimeout)

      const setCookie = homeRes.headers.get('set-cookie') || ''
      const homeHtml = await homeRes.text()
      const $home = cheerio.load(homeHtml)

      let actionUrl = $home('form[name="searchForm"]').attr('action') || '/search'
      if (!actionUrl.startsWith('http')) {
        actionUrl = `${JWC_BASE_URL}${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`
      }

      // Step B: 向教务处搜索接口发起 POST 请求 (type=1: 标题搜索)
      const params = new URLSearchParams()
      params.append('type', '1')
      params.append('k', query)

      const searchController = new AbortController()
      const searchTimeout = setTimeout(() => searchController.abort(), 8000)

      const searchRes = await fetch(actionUrl, {
        method: 'POST',
        signal: searchController.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': setCookie,
          'Referer': JWC_BASE_URL,
        },
        body: params.toString(),
      })
      clearTimeout(searchTimeout)

      if (searchRes.ok) {
        const searchHtml = await searchRes.text()
        const $ = cheerio.load(searchHtml)
        const results: JwcNoticeItem[] = []

        // 解析教务处搜索结果列表项 (.textAreo)
        $('.textAreo').each((_, el) => {
          const aTag = $(el).find('a')
          let title = (aTag.attr('title') || aTag.text()).replace(/\s+/g, ' ').trim()
          const newsId = aTag.attr('newsid') || ''
          const date = $(el).find('i').text().trim() || '近期'

          if (title && newsId) {
            // 提取分类
            let itemCat = '教务通知'
            const catMatch = title.match(/【(.*?)】/)
            if (catMatch) {
              itemCat = catMatch[1]
            }

            results.push({
              title,
              date,
              url: `${JWC_BASE_URL}/info/${newsId}`,
              category: itemCat,
              newsId,
            })
          }
        })

        if (results.length > 0) {
          // 对前 2 篇最关键的最新通知，抓取正文重点摘要
          const topList = results.slice(0, limit)
          await Promise.all(
            topList.slice(0, 2).map(async (item) => {
              if (item.newsId) {
                const snippet = await fetchArticleSnippet(item.newsId)
                if (snippet) {
                  item.snippet = snippet
                }
              }
            }),
          )

          return {
            success: true,
            total: results.length,
            notices: topList,
            query,
            source: 'official_search',
          }
        }
      }
    } catch (searchError) {
      console.warn('[JwcScraper] Official search failed, falling back to homepage feed:', searchError)
    }
  }

  // 2. 兜底策略：如果搜索未提供关键词或搜索无结果，抓取首页聚合通知流
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)

    const response = await fetch(JWC_BASE_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    clearTimeout(timeoutId)

    const html = await response.text()
    const $ = cheerio.load(html)
    const allNotices: JwcNoticeItem[] = []
    const seenTitles = new Set<string>()

    $('a').each((_, elem) => {
      let title = $(elem).attr('title') || $(elem).text()
      title = title.replace(/\s+/g, ' ').trim()

      if (!title || title.length < 4 || title.includes('javascript') || title.includes('更多')) return

      const isNotice = title.startsWith('【') || title.includes('通知') || title.includes('公告') || title.includes('安排')
      if (!isNotice || seenTitles.has(title)) return

      let itemCat = '教务通知'
      const catMatch = title.match(/【(.*?)】/)
      if (catMatch) itemCat = catMatch[1]

      let date = ''
      $(elem).parent().find('i, span, em').each((_, d) => {
        const t = $(d).text().trim()
        if (/^\d{1,2}-\d{1,2}$|^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(t)) {
          date = t
        }
      })

      seenTitles.add(title)
      allNotices.push({
        title,
        date: date || '近期',
        url: JWC_BASE_URL,
        category: itemCat,
      })
    })

    return {
      success: true,
      total: allNotices.length,
      notices: allNotices.slice(0, limit),
      query: query || '全部最新通知',
      source: 'homepage_feed',
    }
  } catch (err: unknown) {
    return {
      success: false,
      total: 0,
      notices: [],
      query,
      source: 'homepage_feed',
      error: String((err as Error)?.message || err),
    }
  }
}
