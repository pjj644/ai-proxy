import { preprocessInput } from '../src/preprocess'
import { buildSystemPrompt } from '../src/prompt'
import { campusKnowledge } from '../src/knowledge/store'

console.log('=== AI 助手全流程知识与提示词校验 ===')

const query1 = '哪里可以使用我的学生邮箱'
const prep1 = preprocessInput(query1)
console.log(`\n1. 用户提问: "${query1}"`)
console.log(`预处理注入内容:\n${prep1.enrichedMessage}`)

const query2 = '信息门户网址是多少'
const prep2 = preprocessInput(query2)
console.log(`\n2. 用户提问: "${query2}"`)
console.log(`预处理注入内容:\n${prep2.enrichedMessage}`)

const query3 = '正版软件从哪里下载'
const prep3 = preprocessInput(query3)
console.log(`\n3. 用户提问: "${query3}"`)
console.log(`预处理注入内容:\n${prep3.enrichedMessage}`)

// 校验 prompt 中约束规则
const prompt = buildSystemPrompt(query1)
console.log('\n=== 系统提示词关键规则抽样校验 ===')
const containsMail = prompt.includes('http://mail.std.uestc.edu.cn/')
const containsOnline = prompt.includes('https://online.uestc.edu.cn/')
const containsNoHttpsMail = !prompt.includes('https://mail.std.uestc.edu.cn/')

console.log(`Prompt 包含正确的学生邮箱 HTTP 链接: ${containsMail ? '✓ 通过' : '✗ 失败'}`)
console.log(`Prompt 包含正确的信息门户 online 链接: ${containsOnline ? '✓ 通过' : '✗ 失败'}`)
console.log(`Prompt 不再包含错误的 HTTPS 邮箱链接: ${containsNoHttpsMail ? '✓ 通过' : '✗ 失败'}`)
