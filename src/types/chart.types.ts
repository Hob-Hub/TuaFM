export type ChartPeriodicity = 'weekly' | 'annual'

export interface ChartRegistry {
  chartId:       string
  name:          string
  shortName:     string
  country:       string          // ISO 3166-1 alpha-2
  flag:          string          // emoji
  language:      string
  periodicities: ChartPeriodicity[]
  listSize:      number
  startYear:     number
  endYear:       number
  totalPeriods:  number
  defaultLambda: number
  description:   string
}

export interface ChartSong {
  position:        number
  artist:          string        // artista principal normalizado (para cacheKey)
  artistDisplay:   string        // con feat., para UI
  title:           string
  youtubeVideoId?: string
  coverUrl?:       string
  weeksInList?:    number
  bestPosition?:   number
}

export interface ChartPeriod {
  chartId:       string
  periodType:    ChartPeriodicity
  year:          number          // ISO week year
  week:          number          // 1-52/53 para weekly; 26 para annual (canonical)
  effectiveWeek: number          // = week para weekly; = 26 para annual
  isoDate:       string          // sábado de publicación o "YYYY-07-01" para annual
  songs:         ChartSong[]
}

export interface RadioCandidate {
  artist:          string
  artistDisplay:   string
  title:           string
  youtubeVideoId?: string
  coverUrl?:       string
  weight:          number
  maxWeeksInList:  number        // máximo semanas para persistenceScore
  appearances:     number
}
