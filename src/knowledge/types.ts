export interface CampusKnowledgeItem {
  id: string
  title: string
  name?: string
  category: 'bus' | 'academic_policy' | 'hospital' | 'facilities' | 'campus_life' | string
  tags: string[]
  summary: string
  content: string
  details?: string
  lastUpdated?: string
  url?: string
  guide?: string
}

export interface CampusServiceItem {
  id: string
  name: string
  category: string
  keywords: string[]
  description: string
  url: string
  guide: string
}

export interface SearchKnowledgeOptions {
  category?: string
  keyword?: string
  limit?: number
}

