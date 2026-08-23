import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CampusKnowledgeItem, SearchKnowledgeOptions } from './types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class CampusKnowledgeStore {
  private static instance: CampusKnowledgeStore
  private items: CampusKnowledgeItem[] = []

  private constructor() {
    this.reload()
  }

  static getInstance(): CampusKnowledgeStore {
    if (!CampusKnowledgeStore.instance) {
      CampusKnowledgeStore.instance = new CampusKnowledgeStore()
    }
    return CampusKnowledgeStore.instance
  }

  reload(): void {
    this.items = []
    const dataDir = path.join(__dirname, 'data')
    if (!fs.existsSync(dataDir)) {
      return
    }

    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(dataDir, file)
          const content = fs.readFileSync(filePath, 'utf-8')
          const parsed = JSON.parse(content) as CampusKnowledgeItem[]
          if (Array.isArray(parsed)) {
            this.items.push(...parsed)
          }
        } catch (e) {
          console.error(`[CampusKnowledgeStore] Failed to load ${file}:`, e)
        }
      }
    }
    console.log(`[CampusKnowledgeStore] Loaded ${this.items.length} knowledge items`)
  }

  search(options: SearchKnowledgeOptions = {}): CampusKnowledgeItem[] {
    const { category, keyword, limit = 5 } = options
    let filtered = this.items

    if (category && category !== 'all') {
      filtered = filtered.filter((item) => item.category === category)
    }

    if (keyword && keyword.trim().length > 0) {
      const fullQuery = keyword.trim().toLowerCase()
      // 1. 基础分词（按空白、标点）
      const baseTokens = fullQuery
        .split(/[\s,，、+&|/._\-!！?？]+/)
        .filter((t) => t.length > 0)

      // 2. 中文 N-Gram 切分（生成 2-gram 和 3-gram 词元以支持中文自然语言无空格提问）
      const ngrams: string[] = []
      for (const t of baseTokens) {
        if (t.length >= 2) {
          for (let i = 0; i < t.length - 1; i++) {
            ngrams.push(t.substring(i, i + 2))
            if (i < t.length - 2) {
              ngrams.push(t.substring(i, i + 3))
            }
          }
        }
      }

      const allTokens = Array.from(new Set([...baseTokens, ...ngrams]))

      const scored = filtered.map((item) => {
        let score = 0
        const titleLower = item.title.toLowerCase()
        const summaryLower = item.summary.toLowerCase()
        const contentLower = item.content.toLowerCase()
        const detailsLower = (item.details || '').toLowerCase()
        const guideLower = (item.guide || '').toLowerCase()
        const tagsLower = item.tags.map((t) => t.toLowerCase())

        // 1. 完整查询命中（最高优先级）
        if (titleLower.includes(fullQuery)) score += 50
        if (tagsLower.some((t) => t.includes(fullQuery) || fullQuery.includes(t))) score += 40
        if (summaryLower.includes(fullQuery)) score += 20
        if (contentLower.includes(fullQuery)) score += 10
        if (detailsLower.includes(fullQuery)) score += 5
        if (guideLower.includes(fullQuery)) score += 5

        // 2. Base Token 命中
        for (const token of baseTokens) {
          if (titleLower.includes(token)) score += 15
          if (tagsLower.some((t) => t.includes(token) || token.includes(t))) score += 12
          if (summaryLower.includes(token)) score += 8
          if (contentLower.includes(token)) score += 4
          if (detailsLower.includes(token)) score += 2
          if (guideLower.includes(token)) score += 2
        }

        // 3. N-Gram 语义片段加权
        for (const gram of ngrams) {
          if (titleLower.includes(gram)) score += 4
          if (tagsLower.some((t) => t.includes(gram))) score += 3
          if (summaryLower.includes(gram)) score += 2
          if (contentLower.includes(gram)) score += 1
        }

        return { item, score }
      })

      filtered = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.item)
    }

    return filtered.slice(0, limit)
  }

  searchServices(query: string, limit: number = 5): CampusKnowledgeItem[] {
    const q = query.toLowerCase().trim()
    return this.items
      .filter((item) =>
        item.title.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.summary.toLowerCase().includes(q) ||
        (item.guide && item.guide.toLowerCase().includes(q))
      )
      .slice(0, limit)
  }

  getAll(category?: string): CampusKnowledgeItem[] {
    if (category && category !== 'all') {
      return this.items.filter((item) => item.category === category)
    }
    return this.items
  }

  addItem(item: CampusKnowledgeItem): void {
    this.items.push(item)
  }
}

export const campusKnowledge = CampusKnowledgeStore.getInstance()
