export interface CampusKnowledgeItem {
  id: string
  title: string
  category: 'bus' | 'academic_policy' | 'hospital' | 'facilities' | 'campus_life' | string
  tags: string[]
  summary: string
  content: string
  details?: string
  lastUpdated?: string
}

export interface SearchKnowledgeOptions {
  category?: string
  keyword?: string
  limit?: number
}
