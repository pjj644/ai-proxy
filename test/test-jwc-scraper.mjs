import { searchJwcWebsite } from '../src/jwcScraper.js'

async function test() {
  console.log('Testing searchJwcWebsite with keyword: "缓补考"...')
  const res1 = await searchJwcWebsite('缓补考')
  console.log('Result 1:', JSON.stringify(res1, null, 2))

  console.log('\nTesting searchJwcWebsite with keyword: "选课"...')
  const res2 = await searchJwcWebsite('选课')
  console.log('Result 2:', JSON.stringify(res2, null, 2))

  console.log('\nTesting searchJwcWebsite (all latest)...')
  const res3 = await searchJwcWebsite()
  console.log('Result 3 count:', res3.notices.length)
}

test().catch(console.error)
