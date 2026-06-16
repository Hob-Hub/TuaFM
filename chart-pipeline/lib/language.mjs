// Inferencia conservadora del idioma principal de una pista.
//
// No hay una fuente externa fiable en el catalogo actual que diga "idioma de la
// letra". Last.fm aporta tags, los charts aportan contexto, y el titulo aporta
// senales lexicales. Por eso exportamos tambien confianza y fuente.

const DIACRITICS = /[\u0300-\u036f]/g
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const clean = value => String(value || '').trim().replace(/\s+/g, ' ')
const stripMarks = value => clean(value).normalize('NFD').replace(DIACRITICS, '')
const norm = value => stripMarks(value).toLowerCase()

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en', 'es', 'fr', 'it', 'pt', 'de', 'nl', 'sv', 'ko', 'ja', 'zh', 'ar', 'hi', 'tr', 'ru', 'el', 'ro',
])

const LANGUAGE_ALIASES = new Map([
  ['english', 'en'], ['ingles', 'en'],
  ['spanish', 'es'], ['espanol', 'es'], ['castellano', 'es'],
  ['french', 'fr'], ['frances', 'fr'], ['francais', 'fr'],
  ['italian', 'it'], ['italiano', 'it'],
  ['portuguese', 'pt'], ['portugues', 'pt'],
  ['german', 'de'], ['deutsch', 'de'], ['aleman', 'de'],
  ['dutch', 'nl'], ['swedish', 'sv'], ['korean', 'ko'], ['japanese', 'ja'], ['chinese', 'zh'],
  ['arabic', 'ar'], ['hindi', 'hi'], ['turkish', 'tr'], ['russian', 'ru'], ['greek', 'el'],
  ['romanian', 'ro'], ['rumano', 'ro'],
])

export function normalizeLanguageCode(code) {
  const raw = norm(code)
  const short = raw.match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/)?.[1]
  if (short && SUPPORTED_LANGUAGE_CODES.has(short)) return short
  return LANGUAGE_ALIASES.get(raw) ?? null
}

const TAG_RULES = [
  { code: 'es', weight: 2.0, terms: ['spanish', 'espanol', 'castellano'] },
  { code: 'es', weight: 1.5, terms: ['reggaeton', 'bachata', 'merengue', 'salsa', 'cumbia', 'flamenco', 'urbano latino', 'latin pop', 'latin trap', 'ranchera', 'vallenato', 'perreo'] },
  { code: 'es', weight: 0.6, terms: ['latin'] },

  { code: 'fr', weight: 2.8, terms: ['chanson', 'variete francaise', 'rap francais'] },
  { code: 'fr', weight: 1.0, terms: ['french', 'francais'] },

  { code: 'it', weight: 1.2, terms: ['italian', 'italiano', 'italo'] },
  { code: 'it', weight: 1.6, terms: ['sanremo'] },

  { code: 'pt', weight: 1.5, terms: ['portuguese', 'portugues'] },
  { code: 'pt', weight: 1.2, terms: ['mpb', 'sertanejo', 'funk carioca', 'pagode', 'bossa nova', 'forro'] },
  { code: 'pt', weight: 0.8, terms: ['brazilian', 'brazil'] },

  { code: 'de', weight: 1.0, terms: ['german', 'deutsch'] },

  { code: 'ko', weight: 0.55, terms: ['korean', 'k-pop', 'kpop'] },
  { code: 'ja', weight: 1.0, terms: ['japanese', 'j-pop', 'jpop', 'j-rock', 'jrock', 'anime'] },
  { code: 'zh', weight: 1.4, terms: ['chinese', 'mandarin', 'cantopop', 'c-pop'] },
  { code: 'ar', weight: 1.2, terms: ['arabic'] },
  { code: 'hi', weight: 1.2, terms: ['hindi', 'bollywood'] },
  { code: 'tr', weight: 1.0, terms: ['turkish'] },
  { code: 'ru', weight: 1.0, terms: ['russian'] },
  { code: 'el', weight: 1.0, terms: ['greek'] },
  { code: 'ro', weight: 1.4, terms: ['romanian', 'romania'] },
  { code: 'sv', weight: 0.7, terms: ['swedish'] },
  { code: 'nl', weight: 0.7, terms: ['dutch'] },

  { code: 'en', weight: 2.0, terms: ['english'] },
  { code: 'en', weight: 0.5, terms: ['british', 'american', 'australian', 'country', 'britpop', 'canadian'] },
]

const TITLE_WORDS = {
  es: {
    strong: ['amor', 'corazon', 'vida', 'noche', 'besame', 'dimelo', 'quiero', 'contigo', 'despacito', 'bailando', 'senorita', 'mujer', 'hombre', 'llorar', 'volver', 'hasta', 'nada', 'todo', 'todos', 'todas', 'ojos', 'boca', 'solo', 'sola'],
    weak: ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'que', 'por', 'para', 'con', 'sin', 'mi', 'mis', 'tu', 'tus', 'te', 'me', 'se', 'no', 'si', 'ya', 'soy', 'eres', 'esta', 'como'],
  },
  en: {
    strong: ['love', 'heart', 'life', 'night', 'baby', 'girl', 'girls', 'boy', 'home', 'dream', 'dreams', 'dance', 'dancing', 'forever', 'never', 'always', 'tonight', 'beautiful', 'lonely', 'happy', 'sorry', 'goodbye', 'hello', 'world', 'sex', 'bomb', 'stolen', 'sun', 'down', 'light', 'lights', 'headlights', 'supergirl', 'speechless', 'roots', 'fading', 'sugar', 'cheerleader', 'reality', 'dynamite', 'butter', 'like', 'back', 'city', 'hips', 'lie', 'whenever', 'wherever', 'fire', 'rain', 'stay', 'away', 'come', 'go', 'run', 'waiting', 'wait', 'stars', 'star'],
    weak: ['i', 'the', 'and', 'you', 'your', 'me', 'my', 'we', 'us', 'they', 'them', 'of', 'to', 'for', 'with', 'without', 'in', 'on', 'at', 'from', 'is', 'it', 'its', 'thats', 'that', 'this', 'what', 'where', 'when', 'why', 'way', 'are', 'be', 'do', 'dont', 'cant', 'wont', 'im', 'ill'],
  },
  fr: {
    strong: ['amour', 'coeur', 'vie', 'nuit', 'danse', 'toujours', 'jamais', 'bonjour', 'adieu', 'femme', 'homme', 'enfant', 'meme', 'comme', 'veux', 'aime', 'france'],
    weak: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'que', 'qui', 'pour', 'avec', 'sans', 'dans', 'sur', 'ne', 'pas', 'est'],
  },
  it: {
    strong: ['amore', 'cuore', 'vita', 'notte', 'bella', 'bello', 'ragazza', 'ragazzo', 'sempre', 'mai', 'ciao', 'soldi', 'mare', 'sole', 'volare', 'cantare', 'zitti', 'buoni'],
    weak: ['il', 'lo', 'la', 'gli', 'le', 'un', 'una', 'di', 'del', 'della', 'dei', 'che', 'io', 'tu', 'lui', 'lei', 'noi', 'voi', 'mi', 'ti', 'si', 'non', 'per', 'con', 'senza', 'sono', 'sei', 'e'],
  },
  pt: {
    strong: ['amor', 'coracao', 'vida', 'noite', 'saudade', 'voce', 'danca', 'beijo', 'menina', 'menino', 'brasil', 'obrigado', 'pego', 'tche', 'dancar'],
    weak: ['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'que', 'eu', 'tu', 'te', 'se', 'ele', 'ela', 'meu', 'minha', 'seu', 'sua', 'nao', 'pra', 'para', 'com', 'sem'],
  },
  de: {
    strong: ['liebe', 'herz', 'leben', 'nacht', 'immer', 'niemals', 'hallo', 'welt', 'madchen'],
    weak: ['der', 'die', 'das', 'ein', 'eine', 'ich', 'du', 'wir', 'ihr', 'sie', 'mein', 'dein', 'nicht', 'und', 'oder', 'mit', 'ohne', 'fur', 'von'],
  },
  nl: {
    strong: ['liefde', 'hart', 'leven', 'nacht', 'altijd', 'nooit', 'meisje'],
    weak: ['de', 'het', 'een', 'ik', 'jij', 'wij', 'mijn', 'jouw', 'niet', 'en', 'of', 'met', 'zonder', 'voor', 'van'],
  },
  sv: {
    strong: ['karlek', 'hjarta', 'liv', 'natt', 'alltid', 'aldrig'],
    weak: ['en', 'ett', 'jag', 'du', 'vi', 'min', 'din', 'inte', 'och', 'eller', 'med', 'utan', 'for'],
  },
  ko: {
    strong: ['gangnam'],
    weak: ['oppa'],
  },
  ro: {
    strong: ['dragostea', 'tei', 'iubire', 'inima', 'viata', 'noapte'],
    weak: ['din', 'si', 'eu', 'tu', 'noi', 'voi', 'nu', 'cu', 'fara', 'pentru'],
  },
}

function addScore(scores, sources, code, weight, source) {
  const lang = normalizeLanguageCode(code)
  if (!lang || weight <= 0) return
  scores.set(lang, (scores.get(lang) || 0) + weight)
  if (!sources.has(lang)) sources.set(lang, new Set())
  sources.get(lang).add(source)
}

function scoreTags(tags, multiplier, source, scores, sources) {
  const tagScores = new Map()
  const addTagScore = (code, weight) => {
    const lang = normalizeLanguageCode(code)
    if (lang && weight > 0) tagScores.set(lang, (tagScores.get(lang) || 0) + weight)
  }
  for (const tag of tags || []) {
    const t = norm(tag)
    if (!t) continue
    const alias = /^[a-z]{2}$/.test(t) ? normalizeLanguageCode(t) : null
    if (alias) addTagScore(alias, 4.0)
    for (const rule of TAG_RULES) {
      if (rule.terms.some(term => t === term || t.includes(term))) {
        addTagScore(rule.code, rule.weight)
      }
    }
  }
  const cap = source === 'track-tag' ? 2.4 : 0.75
  for (const [code, weight] of tagScores) {
    addScore(scores, sources, code, Math.min(weight * multiplier, cap), source)
  }
}

function scoreTitle(title, scores, sources) {
  const raw = clean(title)
  if (!raw) return

  if (/[\uac00-\ud7af]/.test(raw)) addScore(scores, sources, 'ko', 7.0, 'title-script')
  if (/[\u3040-\u30ff]/.test(raw)) addScore(scores, sources, 'ja', 7.0, 'title-script')
  if (/[\u4e00-\u9fff]/.test(raw)) addScore(scores, sources, 'zh', 4.5, 'title-script')
  if (/[\u0600-\u06ff]/.test(raw)) addScore(scores, sources, 'ar', 7.0, 'title-script')
  if (/[\u0900-\u097f]/.test(raw)) addScore(scores, sources, 'hi', 7.0, 'title-script')
  if (/[\u0400-\u04ff]/.test(raw)) addScore(scores, sources, 'ru', 6.0, 'title-script')
  if (/[\u0370-\u03ff]/.test(raw)) addScore(scores, sources, 'el', 6.0, 'title-script')

  if (/[\u00bf\u00a1\u00f1\u00d1]/.test(raw)) addScore(scores, sources, 'es', 2.4, 'title')
  if (/[\u00e3\u00c3\u00f5\u00d5]/.test(raw)) addScore(scores, sources, 'pt', 2.4, 'title')
  if (/[\u00e7\u00c7\u0153\u0152]/.test(raw)) addScore(scores, sources, 'fr', 1.8, 'title')

  const words = norm(raw).replace(/['\u2019]/g, '').match(/[a-z0-9]+/g) || []
  const unique = new Set(words.filter(w => w.length > 1 || ['i', 'a', 'o', 'e', 'y'].includes(w)))
  for (const [code, dict] of Object.entries(TITLE_WORDS)) {
    let strong = 0
    let weak = 0
    for (const word of unique) {
      if (dict.strong.includes(word)) strong++
      else if (dict.weak.includes(word)) weak++
    }
    if (strong) addScore(scores, sources, code, Math.min(5.5, strong * 2.4), 'title')
    if (weak >= 2) addScore(scores, sources, code, Math.min(2.0, weak * 0.22), 'title')
  }
}

function scoreChartSignals(chartSignal, scores, sources) {
  const entries = Object.entries(chartSignal || {})
    .map(([code, value]) => [normalizeLanguageCode(code), Number(value) || 0])
    .filter(([code, value]) => code && value > 0)
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return
  for (const [code, value] of entries) {
    const ratio = value / total
    const weight = entries.length === 1 ? 1.35 : 0.25 + ratio * 1.6
    addScore(scores, sources, code, weight, 'chart')
  }
}

function sourceLabel(sourceSet) {
  const priority = ['override', 'track-tag', 'title-script', 'title', 'artist-tag', 'chart']
  return priority.filter(source => sourceSet?.has(source)).join('+') || 'unknown'
}

export function inferTrackLanguage(track, artists = [], chartSignal = {}) {
  const manual = normalizeLanguageCode(track?.language)
  if (manual) {
    return {
      language: manual,
      languageConfidence: clamp(Number(track.languageConfidence) || 1, 0, 1),
      languageSource: track.languageSource || 'override',
    }
  }

  const scores = new Map()
  const sources = new Map()
  scoreTags(track?.tags, 1.0, 'track-tag', scores, sources)
  scoreTitle(track?.title, scores, sources)

  const ids = track?.artistIds?.length ? track.artistIds : [track?.artistId]
  for (const id of ids) {
    const artist = artists[id]
    if (artist?.tags) scoreTags(artist.tags, 0.22, 'artist-tag', scores, sources)
  }

  scoreChartSignals(chartSignal, scores, sources)

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length) {
    return { language: 'und', languageConfidence: 0, languageSource: 'unknown' }
  }

  const [language, bestScore] = ranked[0]
  const secondScore = ranked[1]?.[1] ?? 0
  const bestSources = sources.get(language) || new Set()
  const onlyChart = bestSources.size === 1 && bestSources.has('chart')
  const margin = bestScore - secondScore

  let confidence = 0.36 + Math.min(bestScore, 7) * 0.065 + Math.min(Math.max(margin, 0), 5) * 0.035
  if (bestSources.has('track-tag') || bestSources.has('title-script')) confidence += 0.1
  if (bestSources.has('title')) confidence += 0.05
  if (margin < 0.7) confidence -= 0.12
  if (onlyChart) confidence = Math.min(confidence, 0.48)
  confidence = clamp(confidence, 0.35, 0.95)

  return {
    language,
    languageConfidence: Number(confidence.toFixed(2)),
    languageSource: sourceLabel(bestSources),
  }
}

export function buildChartLanguageSignals(charts, trackIdByKey) {
  const signals = new Map()
  for (const { config, periods } of charts) {
    const lang = normalizeLanguageCode(config.language)
    if (!lang) continue
    for (const period of periods) {
      for (const song of period.songs) {
        const id = trackIdByKey.get(`${song.artist}::${song.title}`)
        if (id == null) continue
        const signal = signals.get(id) || {}
        signal[lang] = (signal[lang] || 0) + (Number(song.score) || 1) + 0.25
        signals.set(id, signal)
      }
    }
  }
  return signals
}

export function assignTrackLanguages(tracks, artists, chartSignals = new Map()) {
  const byLanguage = {}
  const bySource = {}
  let lowConfidence = 0
  for (const track of tracks) {
    const inferred = inferTrackLanguage(track, artists, chartSignals.get(track.id))
    track.language = inferred.language
    track.languageConfidence = inferred.languageConfidence
    track.languageSource = inferred.languageSource
    byLanguage[inferred.language] = (byLanguage[inferred.language] || 0) + 1
    bySource[inferred.languageSource] = (bySource[inferred.languageSource] || 0) + 1
    if (inferred.languageConfidence < 0.6) lowConfidence++
  }
  return { byLanguage, bySource, lowConfidence }
}
