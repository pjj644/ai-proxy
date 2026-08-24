import 'dotenv/config'
import OpenAI from 'openai'

const MIMO_API_KEY = process.env.MIMO_API_KEY || ''
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1'
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.5'

async function checkReasoningChunks() {
  const client = new OpenAI({ apiKey: MIMO_API_KEY, baseURL: MIMO_BASE_URL })

  console.log('Testing MiMo-2.5 chunk structure...')
  const stream = await client.chat.completions.create({
    model: MIMO_MODEL,
    messages: [{ role: 'user', content: '请问 1+1 等于几？' }],
    stream: true,
  })

  let chunkCount = 0
  for await (const chunk of stream) {
    chunkCount++
    const delta = chunk.choices[0]?.delta as any
    console.log(`Chunk ${chunkCount}:`, JSON.stringify(delta))
  }
}

checkReasoningChunks().catch(console.error)
