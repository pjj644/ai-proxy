import * as cheerio from 'cheerio'

async function testSearch(keyword: string) {
  console.log(`\n=== Testing JWC Search Form POST with keyword: "${keyword}" ===`)

  // Step 1: GET homepage to get Session Cookie & Form Action URL
  const homeRes = await fetch('https://www.jwc.uestc.edu.cn/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
  })
  
  const setCookie = homeRes.headers.get('set-cookie') || ''
  const homeHtml = await homeRes.text()
  const $home = cheerio.load(homeHtml)
  
  let actionUrl = $home('form[name="searchForm"]').attr('action') || '/search'
  if (!actionUrl.startsWith('http')) {
    actionUrl = `https://www.jwc.uestc.edu.cn${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`
  }
  console.log('Action URL:', actionUrl)
  console.log('Set-Cookie:', setCookie)

  // Step 2: POST form data to /search
  const params = new URLSearchParams()
  params.append('type', '1') // 1: 标题, 2: 内容
  params.append('k', keyword)

  const searchRes = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': setCookie,
      'Referer': 'https://www.jwc.uestc.edu.cn/',
    },
    body: params.toString()
  })

  console.log('Search Status:', searchRes.status)
  const searchHtml = await searchRes.text()
  console.log('Search HTML length:', searchHtml.length)

  const $ = cheerio.load(searchHtml)
  console.log('--- SEARCH RESULTS PARSED ---')
  let count = 0
  $('a').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    const href = $(el).attr('href') || ''
    if (text.length > 5 && (href.includes('detail') || href.includes('info') || href.includes('article') || href.includes('content') || text.includes('通知') || text.includes(keyword))) {
      count++
      console.log(`[${count}] ${text} => ${href}`)
    }
  })

  console.log('\n--- ALL LI / RESULT ITEMS IN PAGE ---')
  $('li, tr, .search-list, .list-item').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text.includes(keyword) && text.length > 10 && text.length < 200) {
      console.log('Match block:', text)
    }
  })
}

async function run() {
  await testSearch('四六级')
  await testSearch('转专业')
}

run().catch(console.error)
