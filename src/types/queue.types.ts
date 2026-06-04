export type QueueMode = 'idle' | 'playlist' | 'radio' | 'recommendations'

export interface RecommendCandidate {
  artist:     string
  title:      string
  scoreA:     number
  scoreB:     number
  scoreC:     number
  totalScore: number
}
