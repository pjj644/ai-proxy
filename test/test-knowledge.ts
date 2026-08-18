import { campusKnowledge } from '../src/knowledge/store'

console.log('--- 校园知识库测试 ---')
console.log('知识条目总数:', campusKnowledge.getAll().length)

const queries = [
  '华西医院转诊医保怎么报销',
  '清水河去沙河的校车几点发车',
  '大一转专业条件是什么',
  '四六级免修政策',
  '清水河便民电瓶车路线',
  '宿舍违章电器有哪些限制',
  '保卫处报警电话是多少',
  '银桦食堂有哪些好吃的档口',
  '毕业设计查重率要求'
]

for (const q of queries) {
  const res = campusKnowledge.search({ keyword: q, limit: 2 })
  console.log(`\n🔍 查询: "${q}" -> 召回 ${res.length} 条:`)
  res.forEach((r, i) => {
    console.log(`  [${i + 1}] 《${r.title}》 (分类: ${r.category}, 标签: ${r.tags.join(', ')})`)
    console.log(`      摘要: ${r.summary}`)
  })
}
