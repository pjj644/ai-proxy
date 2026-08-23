import { campusKnowledge } from '../src/knowledge/store'
import { preprocessInput } from '../src/preprocess'

console.log('--- 校园知识库重新加载与测试 ---')
campusKnowledge.reload()
console.log(`总条目数: ${campusKnowledge.getAll().length}`)

const testQueries = [
  '哪里可以使用我的学生邮箱',
  '学生邮箱',
  '邮箱地址',
  '信息门户',
  '云中成电',
  '网上服务大厅',
  '正版软件',
  '寝室电费',
  '校医院',
  '校历'
]

console.log('\n=== 1. 知识库检索测试 ===')
for (const q of testQueries) {
  const results = campusKnowledge.search({ keyword: q, limit: 3 })
  console.log(`\n🔍 Query: "${q}" -> 召回 ${results.length} 条:`)
  for (const r of results) {
    console.log(`  - [${r.title}] URL: ${r.url} | Summary: ${r.summary}`)
  }
}

console.log('\n=== 2. 预处理 RAG 增强测试 ===')
const ragTestQueries = [
  '哪里可以使用我的学生邮箱',
  '信息门户怎么进',
  '帮我查下正版软件在哪里下载',
  '明天有什么课'
]

for (const q of ragTestQueries) {
  const prep = preprocessInput(q)
  console.log(`\nUser: "${q}"`)
  console.log(`Enriched:\n${prep.enrichedMessage}`)
}
