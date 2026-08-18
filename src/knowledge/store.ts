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
      const q = keyword.trim().toLowerCase()
      const scored = filtered.map((item) => {
        let score = 0
        if (item.title.toLowerCase().includes(q)) score += 10
        if (item.tags.some((t) => t.toLowerCase().includes(q))) score += 8
        if (item.summary.toLowerCase().includes(q)) score += 5
        if (item.content.toLowerCase().includes(q)) score += 3
        if (item.details && item.details.toLowerCase().includes(q)) score += 2
        return { item, score }
      })

      filtered = scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.item)
    }

    return filtered.slice(0, limit)
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
