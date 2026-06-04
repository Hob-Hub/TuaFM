# TuaFM — Prompt de construcción completo v5

---

## 1. Descripción de la aplicación

### Concepto y filosofía

**TuaFM** es un reproductor de música web de código abierto diseñado para personas con una relación intensa y curada con la música: oyentes que no solo escuchan sino que *coleccionan* escuchas, que recuerdan en qué año salió un disco, que tienen opiniones sobre qué semana de 1995 fue la más interesante en Los 40. No es una alternativa a Spotify. Es algo diferente: una herramienta de exploración musical con memoria histórica.

El nombre evoca la radio FM de toda la vida — ese medio efímero, no algorítmico, que mezclaba lo nuevo con los clásicos sin pedir permiso — pero con la capa de control y personalización que solo puede ofrecer el software moderno. **Tua** (tuya, en italiano) porque la experiencia es completamente personal: tus listas, tu historia, tu radio imaginaria construida desde los datos reales de los charts.

La app funciona **100% en el navegador**, sin backend propio. No almacena audio: reproduce desde YouTube a través de su IFrame API. Los metadatos (artista, álbum, carátula, géneros, duración, oyentes) los obtiene de Last.fm. Las carátulas que Last.fm no tiene las busca en MusicBrainz y Cover Art Archive. Los datos históricos de charts los sirve Firebase Firestore, poblado por scripts de migración que el operador ejecuta periódicamente.

---

### Los tres modos de TuaFM

TuaFM tiene tres modos de escucha con lógicas distintas pero una interfaz unificada:

#### Modo Playlist — *Tu colección personal*

El modo clásico. El usuario crea playlists manualmente o importa listas en formato CSV con dos columnas: artista y título. La app resuelve cada entrada de forma *lazy* (al reproducirse, no al importarse): consulta primero la caché local (IndexedDB vía Dexie.js), luego la caché compartida en Firestore, y si hay *miss* total llama a Last.fm para enriquecer los metadatos y a YouTube Data API para encontrar el videoId. Una vez resuelto, el resultado se guarda en ambas capas de caché para que futuras reproducciones — por cualquier usuario — sean instantáneas.

El formato CSV de importación es deliberadamente simple:
```
Radiohead,Creep
Oasis,Wonderwall
Café Quijano,La Lola
```
Nada de columnas obligatorias adicionales. El sistema se encarga del resto.

Las playlists se almacenan en IndexedDB (local, permanente en el dispositivo). El usuario puede reordenar pistas con drag-and-drop, marcar favoritos, ver el historial de reproducción y añadir canciones de las otras listas (radio, recomendaciones) con un solo gesto.

#### Modo Radio — *La máquina del tiempo sonora*

El modo más singular de TuaFM. El usuario selecciona una fuente de charts (Los 40 España, Billboard Hot 100 en el futuro...), un año y una semana de referencia. El algoritmo genera una cola de reproducción *efímera* de ~30 canciones que simula cómo habría sonado la radio esa semana: no solo los hits de ese momento, sino también los clásicos de años anteriores que la radio real habría seguido pinchando.

El algoritmo pondera cada canción con tres factores multiplicados:

- **`positionScore`** — cuánto mejor fue su posición en el chart (`1/√pos`): el número 1 tiene peso máximo, el número 40 tiene peso pero no nulo
- **`timeDecay`** — qué tan lejos está del momento de referencia (`e^(-λ·semanas)`): las canciones más recientes tienen más probabilidad, las de hace diez años casi ninguna
- **`persistenceScore`** — cuántas semanas estuvo en lista (`log₂(semanas+1)`): un hit que duró 20 semanas es más "radioable" que uno que desapareció en dos

El slider de **Nostalgia** controla el parámetro `λ`: girado a la izquierda, la radio mezcla épocas generosamente; a la derecha, suena solo lo reciente. Cada fuente de charts tiene su `λ` por defecto calibrado.

La cola es efímera (vive en Pinia, desaparece al cerrar la sesión), pero cualquier pista puede guardarse en una playlist permanente con un solo tap. Las canciones de Los 40 ya llevan el `youtubeVideoId` embebido en los datos del chart (el scraper lo extrae directamente de la fuente), por lo que el modo radio no consume cuota de YouTube Data API.

#### Modo Recomendaciones — *El oráculo de Last.fm*

A partir de los favoritos del usuario (marcados en cualquiera de los otros modos), TuaFM construye una cola de recomendaciones usando exclusivamente las APIs de similitud de Last.fm — sin machine learning propio, sin embeddings, sin coste adicional.

El pipeline tiene tres rutas paralelas:
- **Ruta A (peso 50%)**: `track.getSimilar` para cada favorito → tracks con score de similitud directo
- **Ruta B (peso 30%)**: `artist.getSimilar` → artistas afines → sus `artist.getTopTracks`
- **Ruta C (peso 20%)**: `track.getTopTags` de los favoritos → géneros dominantes → `tag.getTopTracks`

Los candidatos de las tres rutas se agregan, se puntúan, se filtran (eliminando ya-favoritos), se añade un 5% de ruido aleatorio para variedad, y se hace *weighted sampling* del top-60 para generar la cola final.

La cola resultante, igual que la de radio, es efímera y puede convertirse en playlist permanente.

---

### El sistema de charts

TuaFM puede trabajar con múltiples fuentes de charts simultáneamente. La arquitectura está diseñada para que añadir una nueva fuente no requiera cambios en el código de la app: solo un JSON de configuración y un script de migración.

Cada fuente se describe con un **`chartId`** único (p.ej. `los40_es`, `billboard_hot100`) y se registra en la colección `chart_registry` de Firestore. La app lee este catálogo dinámicamente: los charts disponibles en el selector de radio se determinan en tiempo de ejecución, no en tiempo de compilación.

Las fuentes actuales y planificadas:

| chartId | Nombre | País | Periodicidad | Tamaño |
|---|---|---|---|---|
| `los40_es` | Los 40 España | 🇪🇸 | Semanal (desde 2004) | 40 |
| `billboard_hot100` | Billboard Hot 100 | 🇺🇸 | Semanal (futuro) | 100 |
| `billboard_yearend` | Billboard Year-End | 🇺🇸 | Anual (futuro) | 100 |

Los datos de Los 40 se obtienen con el scraper Python propio (extrae el JSON `window.appData` embebido en cada página), que genera una SQLite local. Un script de migración Node.js lee esa SQLite y sube los datos a Firestore en el formato normalizado de TuaFM.

El dato más valioso que provee el scraper de Los 40 es el **`youtubeUrl`** que la propia fuente incluye en su JSON: es la URL exacta del video oficial o de la versión más relevante. TuaFM extrae el `videoId` de esa URL durante la migración y lo embebe en cada entrada del chart, eliminando la necesidad de llamar a YouTube Data API en modo radio.

---

### Arquitectura técnica en tres capas

```
┌──────────────────────────────────────────────────────────────────────────┐
│  CAPA 1 — Pinia + pinia-plugin-persistedstate                            │
│  Estado volátil del reproductor (pista actual, modo de cola, volumen)    │
│  Colas efímeras: radio y recomendaciones (Pinia, desaparecen al cerrar)  │
│  Persistencia parcial en localStorage: solo vol, repeat, shuffle         │
├──────────────────────────────────────────────────────────────────────────┤
│  CAPA 2 — Dexie.js (IndexedDB local)                                     │
│  Playlists del usuario, tracks enriquecidos, favoritos, historial        │
│  Permanente en el dispositivo. ~hundreds of MB de capacidad.             │
│  Reactivo en Vue con liveQuery() + useObservable() de @vueuse/rxjs       │
├──────────────────────────────────────────────────────────────────────────┤
│  CAPA 3 — Firebase Firestore (BaaS compartido, sin servidor propio)      │
│  track_cache: metadatos enriquecidos por cualquier usuario → todos se    │
│    benefician. TTL 30 días. Escritura solo con auth anónima.             │
│  chart_registry: catálogo de fuentes de charts. Solo lectura pública.    │
│  chart_periods: datos de charts por semana/año. Solo lectura pública.    │
│    Escritura solo desde scripts de migración con Admin SDK.              │
└──────────────────────────────────────────────────────────────────────────┘
```

**Lookup de caché al reproducir un track:**
```
1. ¿Dexie tiene el track con cacheKey y no expirado?  → reproducir directo (0 API calls)
2. ¿Firestore track_cache tiene el documento?         → copiar a Dexie → reproducir
3. Miss total → Last.fm + YouTube (si no hay videoId) → Firestore → Dexie → reproducir
```

---

### Flujos de usuario principales

**Crear playlist desde cero:**
Sidebar → Nueva playlist → dar nombre → añadir canciones (búsqueda manual via Last.fm) o importar CSV → reproducir → los tracks se enriquecen en background al reproducirse.

**Usar el modo radio:**
Sidebar → Radio → seleccionar "Los 40 España" → elegir año y semana → ajustar slider Nostalgia → "Generar" → cola de ~30 canciones aparece → reproducción automática → marcar favoritos mientras escuchas → guardar pistas interesantes en playlist.

**Obtener recomendaciones:**
Sidebar → Recomendaciones → "Generar desde mis favoritos" (necesita ≥3 favoritos) → cola de 25 recomendaciones → explorar → añadir a playlist.

**Historial:**
Sidebar → Historial → todas las canciones reproducidas con fecha → relanzar cualquiera.

---

## 2. Arquitectura técnica

### Stack

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Vue 3 | `^3.5` |
| Build | Vite | `^6.x` |
| Lenguaje | TypeScript | `^5.x` strict |
| Estado | Pinia | `^2.3` |
| Estado persistido | pinia-plugin-persistedstate | `^4.x` |
| Routing | Vue Router | `^4.5` |
| Estilos | Tailwind CSS v4 | `@tailwindcss/vite` |
| Utilidades reactivas | VueUse core + rxjs | `^11.x` / `^7.8` |
| DB local | Dexie.js | `^4.4` |
| BaaS | Firebase (solo SDK modular) | `^11.x` |
| CSV | Papa Parse | `^5.x` |
| IDs | nanoid | `^5.x` |

> **Nota v5**: VueFire eliminado. Se usa el SDK modular de Firebase directamente
> (`firebase/firestore`, `firebase/auth`). VueFire añadía ~30KB al bundle sin
> aportar funcionalidad que no tenga ya el SDK modular.

### APIs externas

| Propósito | Servicio | Límite free | Auth |
|---|---|---|---|
| Reproducción | YouTube IFrame Player API | Ilimitado | Ninguna |
| Búsqueda videoId | YouTube Data API v3 | 10k ud/día | Clave Google Cloud |
| Metadatos | Last.fm `track.getInfo`, `artist.getInfo` | Sin límite | Clave Last.fm |
| Similitud | Last.fm `track.getSimilar`, `artist.getSimilar` | Sin límite | Clave Last.fm |
| Top tracks | Last.fm `artist.getTopTracks`, `tag.getTopTracks` | Sin límite | Clave Last.fm |
| Carátulas fallback | MusicBrainz + Cover Art Archive | Ilimitado | Ninguna |
| Caché + charts | Firebase Firestore Spark | 50k read/20k write día | Anónima |

---

### Setup

```bash
npm create vite@latest tuafm -- --template vue-ts
cd tuafm
npm install vue-router@4 pinia pinia-plugin-persistedstate
npm install @vueuse/core @vueuse/rxjs rxjs
npm install dexie
npm install firebase
npm install papaparse nanoid
npm install -D @types/papaparse @vitejs/plugin-vue vite typescript vue-tsc
npm install -D @tailwindcss/vite tailwindcss
```

### `vite.config.ts`
```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
})
```

### `src/style.css`
```css
@import "tailwindcss";
@theme {
  --color-brand:    oklch(0.60 0.20 290);
  --color-surface:  oklch(0.10 0.01 290);
  --color-card:     oklch(0.15 0.01 290);
  --color-muted:    oklch(0.35 0.01 290);
  --font-sans: 'Syne', sans-serif;
  --font-body: 'DM Sans', sans-serif;
}
```

### `.env.local`
```
VITE_YOUTUBE_API_KEY=xxx
VITE_LASTFM_API_KEY=xxx
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_AUTH_DOMAIN=xxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=xxx
VITE_FIREBASE_APP_ID=xxx
```

---

### Estructura de directorios

```
src/
├── main.ts
├── App.vue
├── style.css
├── env.d.ts
├── router/
│   └── index.ts
├── firebase/
│   └── index.ts
├── db/
│   └── local.db.ts
├── stores/
│   ├── player.store.ts
│   ├── radio.store.ts
│   ├── recommendations.store.ts
│   ├── chartRegistry.store.ts      ← nuevo: singleton explícito (Pinia)
│   └── ui.store.ts
├── services/
│   ├── youtube.service.ts
│   ├── lastfm.service.ts
│   ├── lastfm.similarity.service.ts
│   ├── coverart.service.ts
│   ├── trackCache.service.ts
│   ├── radio.service.ts
│   └── recommendations.service.ts
├── composables/
│   ├── useYouTubePlayer.ts
│   ├── useTrackEnrich.ts
│   ├── usePlaylists.ts
│   ├── useFavorites.ts
│   ├── usePlayHistory.ts
│   ├── useCsvImport.ts
│   ├── useRadioQueue.ts
│   └── useRecommendations.ts
├── components/
│   ├── layout/
│   │   ├── AppSidebar.vue
│   │   └── PlayerBar.vue
│   ├── playlist/
│   │   ├── PlaylistList.vue
│   │   ├── PlaylistDetail.vue
│   │   ├── TrackItem.vue           ← compartido entre TODOS los modos
│   │   ├── AddTrackModal.vue
│   │   └── CsvImportModal.vue
│   ├── radio/
│   │   ├── RadioControls.vue
│   │   └── RadioQueueView.vue      ← usa TrackItem
│   ├── recommendations/
│   │   └── RecommendationsView.vue ← usa TrackItem
│   └── ui/
│       ├── BaseButton.vue
│       ├── BaseInput.vue
│       ├── BaseSlider.vue
│       └── TrackCover.vue
├── types/
│   ├── track.types.ts
│   ├── playlist.types.ts
│   ├── chart.types.ts
│   ├── queue.types.ts
│   └── api.types.ts               ← DTOs de Firestore + respuestas Last.fm
└── views/
    ├── HomeView.vue
    ├── PlaylistView.vue
    ├── RadioView.vue
    ├── RecommendationsView.vue
    ├── HistoryView.vue
    └── ArtistView.vue

scripts/                            ← fuera del bundle Vite, package.json propio
├── package.json
├── migrate-to-firestore.mjs
└── chart-configs/
    ├── los40_es.json
    └── billboard_hot100.json       ← plantilla para el futuro

firestore.indexes.json              ← en raíz del proyecto, desplegado con Firebase CLI
```

---

## 3. Tipos TypeScript

### `src/types/api.types.ts`
*DTOs de infraestructura: lo que viaja entre Firestore/APIs y el dominio.*

```ts
// ── Firestore DTOs ───────────────────────────────────────────────────────────

export interface FirestoreTrackCache {
  cacheKey:        string
  artist:          string
  title:           string
  album?:          string
  year?:           number
  duration?:       number
  coverUrl?:       string
  tags?:           string[]
  youtubeVideoId?: string
  listeners?:      number
  cachedAt:        number
  ttlDays:         number
}

// ── Last.fm API responses ────────────────────────────────────────────────────

export interface LastfmTrackResponse {
  track: {
    name: string; duration: string
    artist: { name: string; url: string }
    album?: { title: string; image: Array<{ '#text': string; size: string }> }
    toptags?: { tag: Array<{ name: string }> }
    listeners?: string
  }
}

export interface LastfmArtistResponse {
  artist: {
    name: string
    bio: { summary: string }
    tags: { tag: Array<{ name: string }> }
    image: Array<{ '#text': string; size: string }>
    stats: { listeners: string; playcount: string }
  }
}

export interface LastfmSearchResponse {
  results: {
    trackmatches: {
      track: Array<{
        name: string; artist: string; listeners: string
        image: Array<{ '#text': string; size: string }>
      }>
    }
  }
}

export interface LastfmSimilarTrack {
  name: string; artist: { name: string }; match: string
}

export interface LastfmSimilarArtist {
  name: string; match: string
}

export interface LastfmTopTrack {
  name: string; artist: { name: string }; listeners: string
}

export interface LastfmTopTag {
  name: string; count: number
}
```

### `src/types/track.types.ts`

```ts
export interface Track {
  id:              string        // nanoid local (efímero por sesión/dispositivo)
  title:           string
  artist:          string        // artista principal, normalizado (para cacheKey)
  artistDisplay?:  string        // con feat., para UI
  album?:          string
  year?:           number
  duration?:       number        // ms
  coverUrl?:       string
  tags?:           string[]
  youtubeVideoId?: string        // resuelto lazy o precargado desde chart
  lastfmUrl?:      string
  listeners?:      number
  enriched:        boolean
  enrichError?:    boolean
}

export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
export type RepeatMode  = 'none' | 'one' | 'all'
```

### `src/types/playlist.types.ts`

```ts
export interface Playlist {
  id:           string           // nanoid
  name:         string
  description?: string
  coverUrl?:    string
  trackIds:     string[]         // nanoid IDs de tracks en Dexie
  createdAt:    number
  updatedAt:    number
}

export interface FavoriteTrack {
  // FIX v5: cacheKey como PK, no nanoid.
  // Es el único identificador estable cross-session para una canción.
  cacheKey:    string            // `${artist_norm}::${title_norm}`
  artist:      string
  title:       string
  coverUrl?:   string
  addedAt:     number
}

export interface PlayHistoryEntry {
  id?:         number            // autoincrement Dexie
  cacheKey:    string            // identificador estable
  trackId:     string            // nanoid de la sesión (puede variar)
  artist:      string
  title:       string
  coverUrl?:   string
  queueMode:   'playlist' | 'radio' | 'recommendations'
  playedAt:    number
}
```

### `src/types/chart.types.ts`

```ts
export type ChartPeriodicity = 'weekly' | 'annual'

export interface ChartRegistry {
  chartId:        string
  name:           string
  shortName:      string
  country:        string         // ISO 3166-1 alpha-2
  flag:           string         // emoji
  language:       string
  periodicities:  ChartPeriodicity[]
  listSize:       number
  startYear:      number
  endYear:        number
  totalPeriods:   number
  defaultLambda:  number
  description:    string
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
  maxWeeksInList:  number        // FIX v5: máximo semanas para persistenceScore
  appearances:     number
}
```

### `src/types/queue.types.ts`

```ts
export type QueueMode = 'idle' | 'playlist' | 'radio' | 'recommendations'

export interface RecommendCandidate {
  artist:     string
  title:      string
  scoreA:     number
  scoreB:     number
  scoreC:     number
  totalScore: number
}
```

---

## 4. DB local: Dexie

### `src/db/local.db.ts`

```ts
import Dexie, { type EntityTable } from 'dexie'
import type { Track }              from '@/types/track.types'
import type { Playlist, FavoriteTrack, PlayHistoryEntry } from '@/types/playlist.types'

interface LocalTrack extends Track {
  cacheKey:      string
  localCachedAt: number
}

const db = new Dexie('TuaFMDB') as Dexie & {
  tracks:    EntityTable<LocalTrack,       'id'>
  playlists: EntityTable<Playlist,         'id'>
  favorites: EntityTable<FavoriteTrack,    'cacheKey'>   // FIX v5: PK = cacheKey
  history:   EntityTable<PlayHistoryEntry, 'id'>
}

db.version(1).stores({
  tracks:    'id, cacheKey, artist, localCachedAt',
  playlists: 'id, name, updatedAt',
  favorites: 'cacheKey, artist, addedAt',               // FIX v5: cacheKey como PK
  history:   '++id, cacheKey, playedAt, queueMode'
})

// FIX v5: normalización Unicode para consistencia cross-source
export function normalizeStr(s: string): string {
  return s.toLowerCase().trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // eliminar diacríticos: Beyoncé → beyonce
    .replace(/\s+/g, ' ')             // colapsar espacios múltiples
}

export function makeCacheKey(artist: string, title: string): string {
  return `${normalizeStr(artist)}::${normalizeStr(title)}`
}

export { db }
export type { LocalTrack }
```

---

## 5. Firebase

### `src/firebase/index.ts`

```ts
import { initializeApp }   from 'firebase/app'
import { getFirestore }    from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'

const app = initializeApp({
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:      import.meta.env.VITE_FIREBASE_APP_ID
})

export const firebaseApp = app
export const firestore   = getFirestore(app)
export const auth        = getAuth(app)

export async function ensureAnonymousAuth(): Promise<void> {
  return new Promise(resolve => {
    onAuthStateChanged(auth, async user => {
      if (!user) await signInAnonymously(auth)
      resolve()
    })
  })
}
```

### `firestore.rules`
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /track_cache/{cacheKey} {
      allow read:          if true;
      allow create:        if request.auth != null;
      allow update, delete: if false;
    }
    match /chart_registry/{chartId} {
      allow read:  if true;
      allow write: if false;
    }
    match /chart_periods/{periodId} {
      allow read:  if true;
      allow write: if false;
    }
  }
}
```

### `firestore.indexes.json`
*FIX v5: Índice compuesto requerido para la query de radio. Sin este archivo la app falla al generar radio.*

```json
{
  "indexes": [
    {
      "collectionGroup": "chart_periods",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "chartId", "order": "ASCENDING" },
        { "fieldPath": "year",    "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

Desplegar con: `firebase deploy --only firestore:indexes`

---

## 6. Stores Pinia

### `src/stores/chartRegistry.store.ts`
*FIX v5: singleton explícito en Pinia en lugar de módulo-level refs encubierto.*

```ts
import { defineStore }    from 'pinia'
import { ref, readonly }  from 'vue'
import { collection, getDocs } from 'firebase/firestore'
import { firestore }      from '@/firebase/index'
import type { ChartRegistry }  from '@/types/chart.types'

export const useChartRegistryStore = defineStore('chartRegistry', () => {
  const registries = ref<ChartRegistry[]>([])
  const loaded     = ref(false)
  const loading    = ref(false)

  async function load(): Promise<void> {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const snap   = await getDocs(collection(firestore, 'chart_registry'))
      registries.value = snap.docs.map(d => d.data() as ChartRegistry)
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  function getById(chartId: string): ChartRegistry | undefined {
    return registries.value.find(r => r.chartId === chartId)
  }

  return { registries: readonly(registries), loaded: readonly(loaded), loading: readonly(loading), load, getById }
})
```

### `src/stores/player.store.ts`

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { PlayerState, RepeatMode } from '@/types/track.types'
import type { QueueMode } from '@/types/queue.types'

export const usePlayerStore = defineStore('player', () => {
  const currentTrackId     = ref<string | null>(null)
  const currentPlaylistId  = ref<string | null>(null)
  const queueMode          = ref<QueueMode>('idle')
  const state              = ref<PlayerState>('idle')
  const currentTime        = ref(0)
  const duration           = ref(0)
  const volume             = ref(80)
  const isMuted            = ref(false)
  const repeatMode         = ref<RepeatMode>('none')
  const isShuffle          = ref(false)

  const progress  = computed(() => duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0)
  const isPlaying = computed(() => state.value === 'playing')

  // Resuelve el modo de cola activo verificando que la cola exista
  // (evita queueMode desincronizado tras recarga de página)
  const effectiveQueueMode = computed<QueueMode>(() => {
    if (queueMode.value === 'idle') return 'idle'
    // Las colas efímeras (radio, recommendations) se verifican en los stores correspondientes
    // desde PlayerBar.vue con imports dinámicos para evitar dependencias circulares
    return queueMode.value
  })

  return {
    currentTrackId, currentPlaylistId, queueMode, effectiveQueueMode,
    state, currentTime, duration, volume, isMuted, repeatMode, isShuffle,
    progress, isPlaying
  }
}, {
  persist: { pick: ['volume', 'isMuted', 'repeatMode', 'isShuffle'] }
})
```

### `src/stores/radio.store.ts`

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

export const useRadioStore = defineStore('radio', () => {
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)
  const isActive     = computed(() => queue.value.length > 0)
  const sourceLabel  = ref('')
  const activeChartId  = ref('')
  const activeYear     = ref(new Date().getFullYear())
  const activeWeek     = ref(1)
  const activeLambda   = ref(0.008)   // FIX v5: actualizado con el lambda REAL usado
  const activeWindow   = ref(5)

  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const nextTrack    = computed(() => queue.value[currentIndex.value + 1] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function setQueue(tracks: Track[], label: string, params: {
    chartId: string; year: number; week: number; lambda: number; window: number
  }): void {
    queue.value        = tracks
    currentIndex.value = 0
    sourceLabel.value  = label
    activeChartId.value  = params.chartId
    activeYear.value     = params.year
    activeWeek.value     = params.week
    activeLambda.value   = params.lambda   // FIX v5: lambda resuelto, no el param
    activeWindow.value   = params.window
  }

  function next():          void { if (hasNext.value) currentIndex.value++ }
  function prev():          void { if (hasPrev.value) currentIndex.value-- }
  function skipTo(i: number): void { currentIndex.value = Math.max(0, Math.min(i, queue.value.length - 1)) }
  function clear():         void { queue.value = []; currentIndex.value = 0 }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return {
    queue, currentIndex, isActive, sourceLabel,
    activeChartId, activeYear, activeWeek, activeLambda, activeWindow,
    currentTrack, nextTrack, hasNext, hasPrev,
    setQueue, next, prev, skipTo, clear, updateTrack
  }
})
```

### `src/stores/recommendations.store.ts`

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '@/types/track.types'

export const useRecommendationsStore = defineStore('recommendations', () => {
  // FIX v5: 'generating' eliminado del store → vive en useRecommendations.ts
  const queue        = ref<Track[]>([])
  const currentIndex = ref(0)
  const isActive     = computed(() => queue.value.length > 0)

  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null)
  const hasNext      = computed(() => currentIndex.value < queue.value.length - 1)
  const hasPrev      = computed(() => currentIndex.value > 0)

  function setQueue(tracks: Track[]): void { queue.value = tracks; currentIndex.value = 0 }
  function next():  void { if (hasNext.value) currentIndex.value++ }
  function prev():  void { if (hasPrev.value) currentIndex.value-- }
  function clear(): void { queue.value = []; currentIndex.value = 0 }

  function updateTrack(id: string, data: Partial<Track>): void {
    const idx = queue.value.findIndex(t => t.id === id)
    if (idx >= 0) queue.value[idx] = { ...queue.value[idx], ...data }
  }

  return { queue, currentIndex, isActive, currentTrack, hasNext, hasPrev, setQueue, next, prev, clear, updateTrack }
})
```

---

## 7. Services

### `src/services/trackCache.service.ts`

```ts
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { firestore }           from '@/firebase/index'
import { db, makeCacheKey }    from '@/db/local.db'
import { getTrackInfo }        from '@/services/lastfm.service'
import { searchVideoId }       from '@/services/youtube.service'
import { getCoverUrl }         from '@/services/coverart.service'
import type { Track }          from '@/types/track.types'
import type { FirestoreTrackCache } from '@/types/api.types'
import type { LocalTrack }     from '@/db/local.db'

const CACHE_TTL_DAYS = 30

function isExpired(cachedAt: number, ttlDays: number): boolean {
  return Date.now() - cachedAt > ttlDays * 86_400_000
}

export async function resolveTrack(
  artist:           string,
  title:            string,
  existingVideoId?: string   // precargado desde chart → salta YouTube Data API
): Promise<Partial<Track>> {
  const cacheKey = makeCacheKey(artist, title)

  // FIX v5: .where().equals().first() en lugar de .get({cacheKey})
  const local = await db.tracks.where('cacheKey').equals(cacheKey).first()
  if (local && !isExpired(local.localCachedAt, CACHE_TTL_DAYS)) {
    if (existingVideoId && !local.youtubeVideoId) {
      await db.tracks.update(local.id, { youtubeVideoId: existingVideoId })
      return { ...local, youtubeVideoId: existingVideoId }
    }
    return local
  }

  const fsSnap = await getDoc(doc(firestore, 'track_cache', cacheKey))
  if (fsSnap.exists()) {
    const fsData = fsSnap.data() as FirestoreTrackCache
    if (!isExpired(fsData.cachedAt, fsData.ttlDays)) {
      const merged = { ...fsData, youtubeVideoId: fsData.youtubeVideoId ?? existingVideoId }
      await _persistToLocal(merged, cacheKey)
      return merged
    }
  }

  const enriched = await _fetchExternal(artist, title, existingVideoId)
  await _persistToFirestore(enriched, cacheKey)
  await _persistToLocal(enriched, cacheKey)
  return enriched
}

async function _fetchExternal(
  artist: string, title: string, existingVideoId?: string
): Promise<Partial<Track>> {
  const result: Partial<Track> = { artist, title, enriched: true }

  const tasks: Promise<unknown>[] = [getTrackInfo(artist, title)]
  if (!existingVideoId) tasks.push(searchVideoId(artist, title))

  const [lfm, ytResult] = await Promise.allSettled(tasks)

  if (lfm.status === 'fulfilled') {
    const t         = (lfm.value as any).track
    result.title    = t.name
    result.artist   = t.artist.name
    result.album    = t.album?.title
    result.duration = t.duration ? parseInt(t.duration) : undefined
    result.tags     = t.toptags?.tag.slice(0, 5).map((tag: any) => tag.name) ?? []
    result.listeners = t.listeners ? parseInt(t.listeners) : undefined
    const lfmCover  = t.album?.image.find((i: any) => i.size === 'extralarge')?.['#text']
    result.coverUrl = (lfmCover && lfmCover !== '') ? lfmCover : undefined
  } else {
    result.enrichError = true
  }

  result.youtubeVideoId = existingVideoId
    ?? (ytResult?.status === 'fulfilled' ? (ytResult.value as string | null) ?? undefined : undefined)

  if (!result.coverUrl && result.album) {
    const fallback = await getCoverUrl(result.artist!, result.album).catch(() => null)
    if (fallback) result.coverUrl = fallback
  }

  return result
}

async function _persistToFirestore(data: Partial<Track>, cacheKey: string): Promise<void> {
  try {
    await setDoc(doc(firestore, 'track_cache', cacheKey), {
      cacheKey,
      artist:         data.artist,
      title:          data.title,
      album:          data.album          ?? null,
      duration:       data.duration       ?? null,
      coverUrl:       data.coverUrl       ?? null,
      tags:           data.tags           ?? [],
      youtubeVideoId: data.youtubeVideoId ?? null,
      listeners:      data.listeners      ?? null,
      cachedAt:       Date.now(),
      ttlDays:        CACHE_TTL_DAYS
    } satisfies FirestoreTrackCache)
  } catch (err) {
    console.warn('[trackCache] Firestore write failed:', err)
  }
}

async function _persistToLocal(data: Partial<Track> | FirestoreTrackCache, cacheKey: string): Promise<void> {
  try {
    await db.tracks.put({
      ...data,
      id:            cacheKey,
      cacheKey,
      enriched:      true,
      localCachedAt: Date.now()
    } as LocalTrack)
  } catch (err) {
    console.warn('[trackCache] Dexie write failed:', err)
  }
}
```

### `src/services/radio.service.ts`

```ts
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { firestore }       from '@/firebase/index'
import type { ChartPeriod, ChartRegistry, RadioCandidate } from '@/types/chart.types'
import type { Track }      from '@/types/track.types'
import { nanoid }          from 'nanoid'

// FIX v5: usar year * 53 + week evita colisiones en años con semana 53
// (máximo ISO week = 53, por lo que cada año ocupa un bloque de 53 slots únicos)
function toAbsWeek(year: number, week: number): number {
  return year * 53 + week
}

function positionScore(p: number): number  { return 1 / Math.sqrt(p) }
function timeDecay(w: number, λ: number):  number { return Math.exp(-λ * Math.max(0, w)) }
function persistenceScore(w: number):      number { return Math.log2(w + 1) }

export async function getChartRegistry(chartId: string): Promise<ChartRegistry | null> {
  const snap = await getDoc(doc(firestore, 'chart_registry', chartId))
  return snap.exists() ? (snap.data() as ChartRegistry) : null
}

export async function buildRadioCandidates(
  chartId: string, refYear: number, refWeek: number,
  windowYears: number, lambda: number
): Promise<RadioCandidate[]> {
  const refAbs = toAbsWeek(refYear, refWeek)
  const q = query(
    collection(firestore, 'chart_periods'),
    where('chartId', '==', chartId),
    where('year', '>=', refYear - windowYears),
    where('year', '<=', refYear)
  )
  const snap    = await getDocs(q)
  const periods = snap.docs.map(d => d.data() as ChartPeriod)

  const weightMap = new Map<string, RadioCandidate>()

  for (const period of periods) {
    const docAbs   = toAbsWeek(period.year, period.effectiveWeek)
    if (docAbs > refAbs) continue
    const weeksAgo = refAbs - docAbs

    for (const song of period.songs) {
      const key    = `${song.artist}::${song.title}`   // artist ya normalizado en migración
      const wScore = positionScore(song.position) * timeDecay(weeksAgo, lambda)

      if (weightMap.has(key)) {
        const c = weightMap.get(key)!
        c.weight         += wScore
        c.appearances    += 1
        c.maxWeeksInList  = Math.max(c.maxWeeksInList, song.weeksInList ?? 1)
      } else {
        weightMap.set(key, {
          artist: song.artist, artistDisplay: song.artistDisplay,
          title: song.title, youtubeVideoId: song.youtubeVideoId,
          coverUrl: song.coverUrl,
          weight: wScore, appearances: 1,
          maxWeeksInList: song.weeksInList ?? 1   // FIX v5: track max para persistenceScore
        })
      }
    }
  }

  // FIX v5: persistenceScore aplicado UNA VEZ por canción (sobre el máximo),
  // no multiplicado en cada aparición.
  for (const c of weightMap.values()) {
    c.weight *= persistenceScore(c.maxWeeksInList)
  }

  return Array.from(weightMap.values())
}

export function weightedSample(candidates: RadioCandidate[], n: number): RadioCandidate[] {
  const pool = [...candidates]; const result: RadioCandidate[] = []
  while (result.length < n && pool.length > 0) {
    const total = pool.reduce((s, c) => s + c.weight, 0)
    let rand = Math.random() * total
    for (let i = 0; i < pool.length; i++) {
      rand -= pool[i].weight
      if (rand <= 0) { result.push(pool[i]); pool.splice(i, 1); break }
    }
  }
  return result
}

// FIX v5: devuelve también el lambda resuelto para que el store lo guarde correctamente
export async function generateRadioQueue(params: {
  chartId: string; refYear: number; refWeek: number
  queueSize?: number; windowYears?: number; lambda?: number
}): Promise<{ tracks: Track[]; resolvedLambda: number }> {
  const { chartId, refYear, refWeek, queueSize = 30, windowYears = 5 } = params

  let lambda = params.lambda
  if (lambda === undefined) {
    const registry = await getChartRegistry(chartId)
    lambda = registry?.defaultLambda ?? 0.008
  }

  const candidates = await buildRadioCandidates(chartId, refYear, refWeek, windowYears, lambda)
  const sampled    = weightedSample(candidates, queueSize)

  const tracks = sampled.map(c => ({
    id: nanoid(), artist: c.artist, artistDisplay: c.artistDisplay,
    title: c.title, youtubeVideoId: c.youtubeVideoId, coverUrl: c.coverUrl,
    enriched: false
  } as Track))

  return { tracks, resolvedLambda: lambda }
}
```

### `src/services/recommendations.service.ts`

```ts
import {
  getSimilarTracks, getSimilarArtists, getArtistTopTracks,
  getTrackTopTags,  getTagTopTracks
} from './lastfm.similarity.service'
import type { RecommendCandidate } from '@/types/queue.types'
import type { FavoriteTrack }     from '@/types/playlist.types'
import type { Track }             from '@/types/track.types'
import { nanoid }                 from 'nanoid'
import { makeCacheKey }           from '@/db/local.db'

const WEIGHT_A = 0.50
const WEIGHT_B = 0.30
const WEIGHT_C = 0.20
const MAX_SEEDS = 12

// FIX v5: throttle simple sin VueUse (servicios no son Vue components)
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

async function batchedAllSettled<T>(
  tasks: (() => Promise<T>)[],
  batchSize = 4,
  delayMs   = 200
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map(t => t())
    results.push(...await Promise.allSettled(batch))
    if (i + batchSize < tasks.length) await sleep(delayMs)
  }
  return results
}

export async function buildRecommendations(
  favorites:  FavoriteTrack[],
  outputSize  = 25
): Promise<Track[]> {
  const seeds        = favorites.slice(0, MAX_SEEDS)
  const candidateMap = new Map<string, RecommendCandidate>()
  const favKeys      = new Set(favorites.map(f => makeCacheKey(f.artist, f.title)))

  function upsert(artist: string, title: string, dA: number, dB: number, dC: number): void {
    const key = makeCacheKey(artist, title)
    if (favKeys.has(key)) return   // no recomendar lo ya favorito
    if (candidateMap.has(key)) {
      const c = candidateMap.get(key)!
      c.scoreA += dA; c.scoreB += dB; c.scoreC += dC
      c.totalScore = c.scoreA * WEIGHT_A + c.scoreB * WEIGHT_B + c.scoreC * WEIGHT_C
    } else {
      candidateMap.set(key, {
        artist, title, scoreA: dA, scoreB: dB, scoreC: dC,
        totalScore: dA * WEIGHT_A + dB * WEIGHT_B + dC * WEIGHT_C
      })
    }
  }

  // Ruta A: track.getSimilar en batches de 4
  const routeAResults = await batchedAllSettled(
    seeds.map(fav => () => getSimilarTracks(fav.artist, fav.title, 15))
  )
  for (const r of routeAResults) {
    if (r.status !== 'fulfilled') continue
    for (const t of r.value.similartracks.track)
      upsert(t.artist.name, t.name, parseFloat(t.match) * 100, 0, 0)
  }

  // Ruta B: artistas similares → top tracks
  const uniqueArtists = [...new Set(seeds.map(f => f.artist))].slice(0, 6)
  const routeBResults = await batchedAllSettled(
    uniqueArtists.map(a => () => getSimilarArtists(a, 4))
  )
  const simArtists: string[] = []
  for (const r of routeBResults) {
    if (r.status !== 'fulfilled') continue
    simArtists.push(...r.value.similarartists.artist.map(a => a.name))
  }
  const topTracksResults = await batchedAllSettled(
    [...new Set(simArtists)].slice(0, 10).map(a => () => getArtistTopTracks(a, 4))
  )
  for (const r of topTracksResults) {
    if (r.status !== 'fulfilled') continue
    r.value.toptracks.track.forEach((t, i) => upsert(t.artist.name, t.name, 0, 100 / (i + 1), 0))
  }

  // Ruta C: tags dominantes → top tracks del género
  const tagCountMap = new Map<string, number>()
  const tagResults = await batchedAllSettled(
    seeds.map(f => () => getTrackTopTags(f.artist, f.title))
  )
  for (const r of tagResults) {
    if (r.status !== 'fulfilled') continue
    r.value.toptags.tag.slice(0, 3).forEach((tag, i) =>
      tagCountMap.set(tag.name, (tagCountMap.get(tag.name) ?? 0) + 1 / (i + 1))
    )
  }
  const topTags = [...tagCountMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n)
  const tagTracksResults = await batchedAllSettled(
    topTags.map(tag => () => getTagTopTracks(tag, 10))
  )
  for (const r of tagTracksResults) {
    if (r.status !== 'fulfilled') continue
    r.value.tracks.track.forEach((t, i) => upsert(t.artist.name, t.name, 0, 0, 100 / (i + 1)))
  }

  const pool = [...candidateMap.values()]
    .map(c => ({ ...c, totalScore: c.totalScore + Math.random() * 5 }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 60)

  return _weightedSampleCandidates(pool, outputSize).map(c => ({
    id: nanoid(), artist: c.artist, title: c.title, enriched: false
  } as Track))
}

function _weightedSampleCandidates(pool: RecommendCandidate[], n: number): RecommendCandidate[] {
  const copy = [...pool]; const result: RecommendCandidate[] = []
  while (result.length < n && copy.length > 0) {
    const total = copy.reduce((s, c) => s + c.totalScore, 0)
    let rand = Math.random() * total
    for (let i = 0; i < copy.length; i++) {
      rand -= copy[i].totalScore
      if (rand <= 0) { result.push(copy[i]); copy.splice(i, 1); break }
    }
  }
  return result
}
```

---

## 8. Composables clave

### `src/composables/useRadioQueue.ts`

```ts
import { ref } from 'vue'
import { generateRadioQueue }  from '@/services/radio.service'
import { useRadioStore }       from '@/stores/radio.store'
import { usePlayerStore }      from '@/stores/player.store'
import { useChartRegistryStore } from '@/stores/chartRegistry.store'

export function useRadioQueue() {
  const radioStore    = useRadioStore()
  const playerStore   = usePlayerStore()
  const registryStore = useChartRegistryStore()
  const generating    = ref(false)
  const error         = ref<string | null>(null)

  async function generate(params: {
    chartId: string; refYear: number; refWeek: number
    queueSize?: number; windowYears?: number; lambda?: number
  }): Promise<void> {
    generating.value = true; error.value = null
    try {
      const { tracks, resolvedLambda } = await generateRadioQueue(params)
      const registry  = registryStore.getById(params.chartId)
      const label     = `${registry?.shortName ?? params.chartId} · ${params.refYear} sem.${params.refWeek}`
      // FIX v5: pasar resolvedLambda (no params.lambda ?? default)
      radioStore.setQueue(tracks, label, {
        chartId: params.chartId,
        year:    params.refYear,
        week:    params.refWeek,
        lambda:  resolvedLambda,
        window:  params.windowYears ?? 5
      })
      playerStore.queueMode = 'radio'
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      generating.value = false
    }
  }

  return { generate, generating, error }
}
```

### `src/composables/useFavorites.ts`

```ts
import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track }       from '@/types/track.types'

export function useFavorites() {
  const favorites = useObservable(
    from(liveQuery(() => db.favorites.orderBy('addedAt').reverse().toArray())),
    { initialValue: [] }
  )

  // FIX v5: usa cacheKey como PK (estable cross-session)
  async function addFavorite(track: Track): Promise<void> {
    const cacheKey = makeCacheKey(track.artist, track.title)
    await db.favorites.put({
      cacheKey, artist: track.artist, title: track.title,
      coverUrl: track.coverUrl, addedAt: Date.now()
    })
  }

  async function removeFavorite(artist: string, title: string): Promise<void> {
    await db.favorites.delete(makeCacheKey(artist, title))
  }

  async function isFavorite(artist: string, title: string): Promise<boolean> {
    return !!(await db.favorites.get(makeCacheKey(artist, title)))
  }

  return { favorites, addFavorite, removeFavorite, isFavorite }
}
```

### `src/composables/usePlayHistory.ts`

```ts
import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import { db, makeCacheKey } from '@/db/local.db'
import type { Track }       from '@/types/track.types'
import type { QueueMode }   from '@/types/queue.types'

export function usePlayHistory() {
  // Últimas 200 reproducciones, más recientes primero
  const history = useObservable(
    from(liveQuery(() =>
      db.history.orderBy('playedAt').reverse().limit(200).toArray()
    )),
    { initialValue: [] }
  )

  async function recordPlay(track: Track, mode: QueueMode): Promise<void> {
    if (!track.artist || !track.title) return
    await db.history.add({
      cacheKey:  makeCacheKey(track.artist, track.title),
      trackId:   track.id,
      artist:    track.artist,
      title:     track.title,
      coverUrl:  track.coverUrl,
      queueMode: mode as 'playlist' | 'radio' | 'recommendations',
      playedAt:  Date.now()
    })
  }

  async function clearHistory(): Promise<void> {
    await db.history.clear()
  }

  return { history, recordPlay, clearHistory }
}
```

### `src/composables/useRecommendations.ts`

```ts
import { ref } from 'vue'
import { buildRecommendations }       from '@/services/recommendations.service'
import { useRecommendationsStore }    from '@/stores/recommendations.store'
import { usePlayerStore }             from '@/stores/player.store'
import { useFavorites }               from '@/composables/useFavorites'

export function useRecommendations() {
  const recStore    = useRecommendationsStore()
  const playerStore = usePlayerStore()
  const { favorites } = useFavorites()
  // FIX v5: generating solo en el composable, no en el store
  const generating  = ref(false)
  const error       = ref<string | null>(null)

  async function generate(outputSize = 25): Promise<void> {
    if (!favorites.value || favorites.value.length < 3) {
      error.value = 'Necesitas al menos 3 favoritos para generar recomendaciones'
      return
    }
    generating.value = true; error.value = null
    try {
      const tracks = await buildRecommendations(favorites.value, outputSize)
      recStore.setQueue(tracks)
      playerStore.queueMode = 'recommendations'
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      generating.value = false
    }
  }

  return { generate, generating, error }
}
```

---

## 9. PlayerBar — lógica de navegación multi-modo

*FIX v5: La lógica de `playNext`/`playPrev` ausente en v4 se especifica aquí.*

```ts
// Dentro de PlayerBar.vue <script setup>
import { usePlayerStore }          from '@/stores/player.store'
import { useRadioStore }           from '@/stores/radio.store'
import { useRecommendationsStore } from '@/stores/recommendations.store'
import { usePlaylists }            from '@/composables/usePlaylists'
import { usePlayHistory }          from '@/composables/usePlayHistory'
import { useTrackEnrich }          from '@/composables/useTrackEnrich'

const playerStore = usePlayerStore()
const radioStore  = useRadioStore()
const recStore    = useRecommendationsStore()
const { recordPlay } = usePlayHistory()
const { enrich }     = useTrackEnrich()

// Pista activa, independiente del modo
const currentTrack = computed(() => {
  const mode = playerStore.queueMode
  if (mode === 'radio')           return radioStore.currentTrack
  if (mode === 'recommendations') return recStore.currentTrack
  // mode === 'playlist': obtener de Dexie via currentTrackId
  return null // implementar según playlist activa
})

// Enriquecer lazy cuando cambia la pista activa
watch(currentTrack, async (track) => {
  if (!track || track.enriched) return
  const enriched = await enrich(track)
  if (playerStore.queueMode === 'radio')
    radioStore.updateTrack(track.id, enriched)
  else if (playerStore.queueMode === 'recommendations')
    recStore.updateTrack(track.id, enriched)
  // Registrar en historial
  if (track.artist) recordPlay(track, playerStore.queueMode as any)
})

function playNext(): void {
  const mode = playerStore.queueMode
  if (mode === 'radio')           { radioStore.next(); return }
  if (mode === 'recommendations') { recStore.next();   return }
  // playlist: lógica con shuffle/repeat
  playlistNext()
}

function playPrev(): void {
  const mode = playerStore.queueMode
  // Si llevamos más de 3 segundos, reiniciar; si no, ir a anterior
  if (playerStore.currentTime > 3) { ytPlayer.seekTo(0); return }
  if (mode === 'radio')           { radioStore.prev(); return }
  if (mode === 'recommendations') { recStore.prev();   return }
  playlistPrev()
}

// FIX v5: Guardar pista efímera en playlist (radio/recommendations → Dexie)
async function saveCurrentToPlaylist(playlistId: string): Promise<void> {
  const track = currentTrack.value
  if (!track) return
  const { addTrack } = usePlaylists()
  // El track puede no tener id Dexie aún; addTrack lo persiste
  await addTrack(playlistId, track)
}
```

---

## 10. Script de migración

### `scripts/chart-configs/los40_es.json`
```json
{
  "chartId":        "los40_es",
  "name":           "Los 40 España",
  "shortName":      "Los 40",
  "country":        "ES",
  "flag":           "🇪🇸",
  "language":       "es",
  "periodicities":  ["weekly"],
  "listSize":       40,
  "defaultLambda":  0.008,
  "description":    "Lista semanal de los 40 éxitos más escuchados en España (desde 2004)",
  "source": {
    "type":            "sqlite",
    "dbPath":          "./los40.db",
    "query":           "SELECT chart_date, position, song AS title, artists AS artist_raw, cover_url, youtube_url, weeks_in_list, best_position FROM v_chart WHERE chart_date >= '2004-01-01' ORDER BY chart_date, position",
    "artistSeparator": ";",
    "dateField":       "chart_date",
    "posField":        "position",
    "titleField":      "title",
    "artistField":     "artist_raw",
    "ytUrlField":      "youtube_url",
    "coverField":      "cover_url",
    "weeksField":      "weeks_in_list",
    "bestField":       "best_position"
  }
}
```

### `scripts/migrate-to-firestore.mjs`

```js
#!/usr/bin/env node
// Uso: node migrate-to-firestore.mjs chart-configs/los40_es.json
// Scripts deps: cd scripts && npm install firebase-admin better-sqlite3 luxon

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore }        from 'firebase-admin/firestore'
import Database                from 'better-sqlite3'
import { readFileSync }        from 'fs'
import { resolve, dirname }    from 'path'
import { fileURLToPath }       from 'url'
import { DateTime }            from 'luxon'

const __dir   = dirname(fileURLToPath(import.meta.url))
const config  = JSON.parse(readFileSync(resolve(__dir, process.argv[2]), 'utf8'))
const svcAcct = JSON.parse(readFileSync(resolve(__dir, 'service-account.json'), 'utf8'))

initializeApp({ credential: cert(svcAcct) })
const db_fs  = getFirestore()
const db_sql = new Database(resolve(__dir, config.source.dbPath))

// FIX v5: normalización idéntica a la app para consistencia de cacheKey
function normalizeStr(s) {
  return s.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function extractVideoId(url) {
  if (!url) return null
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

// FIX v5: separador configurable por fuente (evita split agresivo en "Simon & Garfunkel")
function splitArtist(raw, separator) {
  const sep    = separator || ';'
  const first  = raw.split(sep)[0].trim()
  return {
    artist:        normalizeStr(first),         // normalizado, para cacheKey
    artistDisplay: raw.replace(new RegExp(sep, 'g'), ', ').trim()  // para UI
  }
}

const rows = db_sql.prepare(config.source.query).all()
const periodsMap = new Map()

for (const row of rows) {
  const d = row[config.source.dateField]
  if (!periodsMap.has(d)) periodsMap.set(d, [])
  periodsMap.get(d).push(row)
}

console.log(`${config.chartId}: ${periodsMap.size} períodos a migrar`)

const BATCH = 400
let batch = db_fs.batch()
let count = 0
let minYear = 9999, maxYear = 0

for (const [dateStr, songs] of periodsMap) {
  const dt   = DateTime.fromISO(dateStr)
  // FIX v5: usar weekYear (ISO year) en lugar de calendar year para semanas limítrofes
  const year = dt.weekYear
  const week = dt.weekNumber

  if (year < minYear) minYear = year
  if (year > maxYear) maxYear = year

  const docId = `${config.chartId}_${year}_W${String(week).padStart(2, '0')}`
  const ref   = db_fs.collection('chart_periods').doc(docId)

  batch.set(ref, {
    chartId:       config.chartId,
    periodType:    'weekly',
    year, week,
    effectiveWeek: week,
    isoDate:       dateStr,
    songs: songs.map(s => {
      const raw = String(s[config.source.artistField] || '')
      const { artist, artistDisplay } = splitArtist(raw, config.source.artistSeparator)
      return Object.fromEntries(Object.entries({
        position:       Number(s[config.source.posField]),
        artist,
        artistDisplay,
        title:          normalizeStr(String(s[config.source.titleField] || '')),
        youtubeVideoId: extractVideoId(config.source.ytUrlField ? s[config.source.ytUrlField] : null),
        coverUrl:       config.source.coverField ? s[config.source.coverField] || null : null,
        weeksInList:    config.source.weeksField ? Number(s[config.source.weeksField]) || null : null,
        bestPosition:   config.source.bestField  ? Number(s[config.source.bestField])  || null : null
      }).filter(([, v]) => v !== null))
    })
  }, { merge: false })

  count++
  if (count % BATCH === 0) {
    await batch.commit()
    batch = db_fs.batch()
    process.stdout.write(`  ${count} subidos...\r`)
  }
}

await batch.commit()
console.log(`\n✓ ${count} períodos subidos (${minYear}–${maxYear})`)

// Actualizar chart_registry
await db_fs.collection('chart_registry').doc(config.chartId).set({
  chartId: config.chartId, name: config.name, shortName: config.shortName,
  country: config.country, flag: config.flag, language: config.language,
  periodicities: config.periodicities, listSize: config.listSize,
  defaultLambda: config.defaultLambda, description: config.description,
  startYear: minYear, endYear: maxYear, totalPeriods: count
}, { merge: true })

console.log(`✓ chart_registry/${config.chartId} actualizado`)
db_sql.close()
```

---

## 11. Routing, main.ts, env.d.ts

### `src/router/index.ts`
```ts
import { createRouter, createWebHistory } from 'vue-router'
export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',                name: 'home',    component: () => import('@/views/HomeView.vue') },
    { path: '/playlist/:id',   name: 'playlist', component: () => import('@/views/PlaylistView.vue') },
    { path: '/radio',          name: 'radio',    component: () => import('@/views/RadioView.vue') },
    { path: '/recommendations',name: 'recs',     component: () => import('@/views/RecommendationsView.vue') },
    { path: '/history',        name: 'history',  component: () => import('@/views/HistoryView.vue') },
    { path: '/artist/:name',   name: 'artist',   component: () => import('@/views/ArtistView.vue') }
  ]
})
```

### `src/main.ts`
```ts
import { createApp }   from 'vue'
import { createPinia } from 'pinia'
import piniaPersistedstate from 'pinia-plugin-persistedstate'
import router          from '@/router/index'
import App             from './App.vue'
import './style.css'

const pinia = createPinia()
pinia.use(piniaPersistedstate)

createApp(App).use(pinia).use(router).mount('#app')

// Auth anónima en background — necesaria para poder escribir en track_cache
import('@/firebase/index').then(({ ensureAnonymousAuth }) =>
  ensureAnonymousAuth().catch(console.warn)
)
```

### `src/env.d.ts`
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_YOUTUBE_API_KEY:      string
  readonly VITE_LASTFM_API_KEY:       string
  readonly VITE_FIREBASE_API_KEY:     string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID:  string
  readonly VITE_FIREBASE_APP_ID:      string
}
interface ImportMeta { readonly env: ImportMetaEnv }
```

---

## 12. package.json

```json
{
  "name": "tuafm",
  "dependencies": {
    "vue":                         "^3.5.0",
    "vue-router":                  "^4.5.0",
    "pinia":                       "^2.3.0",
    "pinia-plugin-persistedstate": "^4.2.0",
    "@vueuse/core":                "^11.0.0",
    "@vueuse/rxjs":                "^11.0.0",
    "rxjs":                        "^7.8.0",
    "dexie":                       "^4.4.0",
    "firebase":                    "^11.0.0",
    "papaparse":                   "^5.4.0",
    "nanoid":                      "^5.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue":          "^5.2.0",
    "vite":                        "^6.0.0",
    "typescript":                  "^5.7.0",
    "@tailwindcss/vite":           "^4.0.0",
    "tailwindcss":                 "^4.0.0",
    "vue-tsc":                     "^2.0.0",
    "@types/papaparse":            "^5.3.0"
  }
}
```

> **Scripts:** `cd scripts && npm install firebase-admin better-sqlite3 luxon`

---

## 13. Fixes aplicados respecto a v4

| Fix | Bug/Issue | Solución |
|---|---|---|
| B1 | `dexie.tracks.get({cacheKey})` incorrecto | `.where('cacheKey').equals(cacheKey).first()` |
| B2 | Lambda incorrecta en store | `generateRadioQueue` devuelve `resolvedLambda`; store lo usa |
| B3 | `toAbsWeek` con años de 53 semanas | `year * 53 + week` (sin colisiones, max ISO week = 53) |
| B4 | `splitArtists` rompe con `&` | `artistSeparator` configurable en JSON; solo split por el sep declarado |
| B5 | `FavoriteTrack.id` inestable | PK = `cacheKey` (stable cross-session) |
| I1 | VueFire sin usar | Eliminado; SDK modular de Firebase directamente |
| I2 | `FirestoreTrackCache` en tipos de dominio | Movido a `api.types.ts` |
| I4 | `generating` duplicado store/composable | Solo en composable |
| I5 | `useChartRegistry` singleton encubierto | Pinia store explícito (`chartRegistry.store.ts`) |
| A2 | `playNext`/`playPrev` ausente | Especificado en `PlayerBar.vue` |
| A3 | Flujo efímero → playlist ausente | `saveCurrentToPlaylist()` en `PlayerBar.vue` |
| A4 | `api.types.ts` vacío | Implementado con DTOs Firestore + respuestas Last.fm |
| A1 | `usePlayHistory` sin implementar | Implementado completo |
| C1 | `cacheKey` frágil con diacríticos | `normalizeStr()` con NFD + strip diacríticos |
| C3 | Sin throttling en recommendations | `batchedAllSettled()` con delay entre batches |
| I6 | Índice Firestore no documentado | `firestore.indexes.json` + instrucción de deploy |
| Nuevo | `weekYear` vs `year` en migración | Usa `dt.weekYear` (ISO) para semanas limítrofes |
| Nuevo | `persistenceScore` doble-conteo | Aplicado UNA vez sobre `maxWeeksInList` tras acumular |

---

## 14. Instrucciones de construcción para el AI

1. **Orden**: `types/api.types.ts → types/track.types.ts → types/playlist.types.ts → types/chart.types.ts → types/queue.types.ts → firebase/index.ts → db/local.db.ts → services/youtube.service.ts → services/lastfm.service.ts → services/lastfm.similarity.service.ts → services/coverart.service.ts → services/trackCache.service.ts → services/radio.service.ts → services/recommendations.service.ts → stores/chartRegistry.store.ts → stores/player.store.ts → stores/radio.store.ts → stores/recommendations.store.ts → stores/ui.store.ts → composables/useYouTubePlayer.ts → composables/useTrackEnrich.ts → composables/usePlaylists.ts → composables/useFavorites.ts → composables/usePlayHistory.ts → composables/useCsvImport.ts → composables/useRadioQueue.ts → composables/useRecommendations.ts → components/ui/* → components/player/* → components/playlist/* → components/radio/* → components/recommendations/* → views/* → App.vue → main.ts`

2. **`<script setup lang="ts">` en todos los SFCs.** Sin Options API.

3. **Los componentes no importan services.** Solo composables y stores.

4. **`TrackItem.vue` es el componente universal de pista.** Funciona en modo playlist, radio y recomendaciones. Acepta props: `track: Track`, `mode: QueueMode`, `isActive: boolean`. Muestra estado de enriquecimiento (`enriched: false` → skeleton/loader).

5. **`resolveTrack(artist, title, existingVideoId?)` es la única puerta de entrada** para enriquecer tracks. Todo lo demás llama a esta función, nunca a los servicios individuales directamente.

6. **Dexie reactivo**: `useObservable(from(liveQuery(...)))` siempre. Sin suscripciones manuales.

7. **El IFrame de YouTube** instanciado una vez en `App.vue`. `PlayerBar.vue` fuera del `<RouterView>`.

8. **Auth anónima** lazy en `main.ts` vía import dinámico. Los servicios que escriben en Firestore asumen auth disponible.

9. **Tailwind v4**: sin `tailwind.config.js`. Variables en `src/style.css` con `@theme`.

10. **`firestore.indexes.json`** debe desplegarse antes del primer uso de radio: `firebase deploy --only firestore:indexes`.

11. **Scripts de migración** en `scripts/` con su propio `package.json`. No incluir en bundle Vite. Ejecutar: `node scripts/migrate-to-firestore.mjs scripts/chart-configs/los40_es.json`.

12. **Añadir nueva fuente de charts** = crear `scripts/chart-configs/{chartId}.json` + ejecutar el script. Cero cambios en código de la app.

13. **Sin librerías de componentes UI**. Todo Tailwind puro con las variables de `@theme`.

---

## 15. Roadmap de ejecución por fases

> Cada fase tiene **prerequisitos claros**, **tareas ordenadas** y un **criterio de verificación**.
> No avanzar a la siguiente fase sin que la verificación pase.

---

### FASE 0 — Infraestructura y claves *(~1 día)*

**Prerequisito:** ninguno.

**Tareas:**
1. Scaffold: `npm create vite@latest tuafm -- --template vue-ts`
2. Instalar todas las dependencias del `package.json` principal
3. Configurar `vite.config.ts` (Tailwind v4 + alias `@`)
4. Crear proyecto Firebase → habilitar Firestore + Authentication (proveedor: Anónimo)
5. Desplegar reglas: `firebase deploy --only firestore:rules`
6. Desplegar índice compuesto: `firebase deploy --only firestore:indexes`
7. Crear API key en Google Cloud → habilitar YouTube Data API v3 → restringir por HTTP Referer
8. Registrar app en Last.fm → obtener API key
9. Crear `.env.local` con las 6 variables de entorno
10. Crear `src/env.d.ts` con `ImportMetaEnv`
11. Crear `scripts/package.json` e instalar `firebase-admin`, `better-sqlite3`, `luxon`

**Verificación:** `npm run dev` arranca sin errores. Las 6 variables de entorno están disponibles en `import.meta.env`.

---

### FASE 1 — Tipos, base de datos y Firebase *(~1 día)*

**Prerequisito:** Fase 0 completa.

**Tareas (en orden):**
1. `src/types/api.types.ts` — DTOs Firestore + respuestas Last.fm
2. `src/types/track.types.ts`
3. `src/types/playlist.types.ts`
4. `src/types/chart.types.ts`
5. `src/types/queue.types.ts`
6. `src/firebase/index.ts` — `initializeApp`, `getFirestore`, `getAuth`, `ensureAnonymousAuth`
7. `src/db/local.db.ts` — schema Dexie completo + `makeCacheKey` + `normalizeStr`
8. `src/stores/player.store.ts` — solo estado, sin lógica de reproducción aún
9. `src/stores/ui.store.ts` — flags de modales y sidebar

**Verificación:** abrir DevTools → Application → IndexedDB → la BD `TuaFMDB` aparece con las 4 tablas vacías. La consola no muestra errores de TypeScript.

---

### FASE 2 — Shell de la aplicación *(~1 día)*

**Prerequisito:** Fase 1 completa.

**Tareas (en orden):**
1. `src/router/index.ts` — todas las rutas con lazy loading
2. `src/main.ts` — createApp + Pinia + Router + auth anónima lazy
3. `App.vue` — layout CSS Grid (sidebar 220px | content 1fr), PlayerBar en footer fijo
4. `components/ui/BaseButton.vue`, `BaseInput.vue`, `BaseSlider.vue`, `TrackCover.vue`
5. `components/layout/AppSidebar.vue` — logo TuaFM, nav items, sección playlists (vacía)
6. `components/layout/PlayerBar.vue` — shell visual completo, sin lógica de reproducción
7. Vistas vacías (solo `<template><div>Vista X</div></template>`): Home, Playlist, Radio, Recommendations, History
8. `src/style.css` con variables `@theme` de Tailwind v4

**Verificación:** la app muestra el layout con sidebar, área de contenido y barra de player. La navegación entre vistas funciona. El shell visual de PlayerBar es visible pero inactivo.

---

### FASE 3 — Reproductor YouTube *(~1 día)*

**Prerequisito:** Fase 2 completa.

**Tareas (en orden):**
1. `src/composables/useYouTubePlayer.ts` — wrapper IFrame API, eventos, ticker
2. `components/player/YouTubeFrame.vue` — iframe invisible (`height: 0`) montado en `App.vue`
3. `components/player/ProgressBar.vue` — seekable, reactiva a `player.store.currentTime`
4. `components/player/NowPlaying.vue` — cover + título + artista de la pista activa
5. Conectar PlayerBar con `useYouTubePlayer`: play/pause, seek, volumen, mute
6. `src/composables/usePlayHistory.ts` — `recordPlay()` llamado desde PlayerBar al cambiar pista

**Verificación:** en la consola del navegador, llamar manualmente `ytPlayer.loadAndPlay('dQw4w9WgXcQ')`. El audio se reproduce, la barra de progreso avanza, el ticker actualiza `playerStore.currentTime`.

---

### FASE 4 — Pipeline de enriquecimiento *(~2 días)*

**Prerequisito:** Fase 3 completa.

**Tareas (en orden):**
1. `src/services/lastfm.service.ts` — `getTrackInfo`, `getArtistInfo`, `searchTrack`
2. `src/services/youtube.service.ts` — `searchVideoId`
3. `src/services/coverart.service.ts` — MusicBrainz + Cover Art Archive
4. `src/services/trackCache.service.ts` — lookup completo: Dexie → Firestore → APIs → persist
5. `src/composables/useTrackEnrich.ts` — wrapper reactivo con `enriching` y `error`

**Verificación:** desde la consola: `resolveTrack('Radiohead', 'Creep')` debe devolver objeto con `album`, `coverUrl`, `tags`, `youtubeVideoId`. La segunda llamada debe venir de Dexie (0 peticiones de red). La tercera vez, desde Firestore si se abrió en otro navegador.

---

### FASE 5 — Playlists completas *(~2 días)*

**Prerequisito:** Fase 4 completa.

**Tareas (en orden):**
1. `src/composables/usePlaylists.ts` — CRUD completo con `liveQuery`
2. `src/composables/useFavorites.ts` — con `cacheKey` como PK
3. `src/composables/useCsvImport.ts` — PapaParse + validación fila a fila
4. `components/playlist/TrackItem.vue` — **componente universal**, tres estados visuales:
   - `enriched: false` → skeleton animado (título/artista, sin cover)
   - `enriched: true` → datos completos con cover, duración, tags
   - `enrichError: true` → icono de error + datos parciales, reproducción posible
5. `components/playlist/AddTrackModal.vue` — búsqueda Last.fm + selección de resultado
6. `components/playlist/CsvImportModal.vue` — upload, preview, filas válidas/inválidas, confirmar
7. `components/playlist/PlaylistList.vue` — grid de tarjetas en HomeView
8. `components/playlist/PlaylistDetail.vue` — lista de tracks + botón añadir + drag-to-reorder
9. `views/PlaylistView.vue` — orquesta PlaylistDetail + lógica de reproducción
10. Lógica `playNext`/`playPrev` en PlayerBar para modo playlist (con shuffle y repeat)
11. Enriquecimiento lazy en PlayerBar: `watch(currentTrack, () => enrich(track))`

**Verificación:** flujo completo end-to-end:
- Crear playlist → importar CSV con 10 canciones → algunas se muestran en skeleton → reproducir primera → el skeleton se convierte en datos reales → marcar favorito → ir a siguiente (reproduce sin recargar) → abrir otra pestaña → la playlist persiste.

---

### FASE 6 — Modo Radio *(~2 días)*

**Prerequisito:** Fase 5 completa. **Datos de Los 40 en Firestore** (ver paso 0 de esta fase).

**Paso 0 — Datos (fuera del código de la app):**
- Ejecutar el scraper Python de Los 40 para generar `los40.db`
- Ejecutar: `node scripts/migrate-to-firestore.mjs scripts/chart-configs/los40_es.json`
- Verificar en Firestore Console que `chart_registry/los40_es` existe y `chart_periods` tiene documentos

**Tareas (en orden):**
1. `src/stores/chartRegistry.store.ts` — carga desde Firestore, singleton Pinia
2. `src/services/radio.service.ts` — `getChartRegistry`, `buildRadioCandidates`, `generateRadioQueue`
3. `src/stores/radio.store.ts` — cola efímera, next/prev/skipTo, `setQueue` con params completos
4. `src/composables/useRadioQueue.ts` — `generate()` con lambda resuelto
5. `components/radio/RadioControls.vue`:
   - Selector de chart (carga desde `chartRegistryStore`, muestra flag + nombre)
   - Inputs año (min: `registry.startYear`, max: `registry.endYear`) y semana (1-52)
   - Slider Nostalgia (λ: 0.003 ↔ 0.015, step 0.001)
   - Botón "Generar" con estado de carga
   - Defaults: año actual, semana actual, `registry.defaultLambda`
6. `components/radio/RadioQueueView.vue` — lista de TrackItem en modo radio
7. `views/RadioView.vue` — RadioControls + RadioQueueView
8. Conectar PlayerBar con `radioStore`: `playNext` → `radioStore.next()` en modo radio
9. Botón "Guardar en playlist" en TrackItem (modo radio): `saveCurrentToPlaylist(playlistId)`

**Verificación:** seleccionar Los 40 España → año 2010 → semana 30 → generar. La cola aparece con ~30 canciones. Las canciones de Los 40 tienen `youtubeVideoId` ya resuelto (sin llamadas a YouTube Data API en Network tab). La reproducción fluye de pista en pista.

---

### FASE 7 — Recomendaciones *(~2 días)*

**Prerequisito:** Fase 5 completa (necesita favoritos).

**Tareas (en orden):**
1. `src/services/lastfm.similarity.service.ts` — `getSimilarTracks`, `getSimilarArtists`, `getArtistTopTracks`, `getTrackTopTags`, `getTagTopTracks`
2. `src/services/recommendations.service.ts` — pipeline 3 rutas con `batchedAllSettled`
3. `src/stores/recommendations.store.ts`
4. `src/composables/useRecommendations.ts` — `generating` solo aquí, no en el store
5. `components/recommendations/RecommendationsView.vue` — usa TrackItem + botón Generar
6. `views/RecommendationsView.vue`
7. Conectar PlayerBar con `recommendationsStore`: next/prev en modo recomendaciones

**Verificación:** marcar ≥3 favoritos variados (distintos géneros) → "Generar recomendaciones" → la cola no contiene los propios favoritos → las canciones son plausiblemente similares → en Network tab, las peticiones a Last.fm van en batches de 4 con pausas visibles entre grupos.

---

### FASE 8 — Vistas secundarias *(~1 día)*

**Prerequisito:** Fases 5-7 completas.

**Tareas:**
1. `views/HistoryView.vue` — lista de `PlayHistoryEntry` de Dexie, agrupada por fecha, con modo (playlist/radio/rec) como badge
2. `views/ArtistView.vue` — info de artista via `artist.getInfo` de Last.fm + top tracks + link a radio por artista
3. `AppSidebar.vue` — sección de playlists ahora muestra la lista real (liveQuery Dexie)
4. Verificar que `saveCurrentToPlaylist()` funciona desde PlayerBar para modos radio y recomendaciones (selector de playlist destino)

**Verificación:** reproducir 5 canciones desde diferentes modos → ir a Historial → aparecen ordenadas por fecha con el modo correcto. Clicar un artista en TrackItem → ArtistView muestra su bio y top tracks.

---

### FASE 9 — Calidad y despliegue *(~1-2 días)*

**Prerequisito:** Fases 0-8 completas.

**Tareas:**
1. **Estados de error globales**: all API calls en try/catch con feedback visual en UI (no solo `console.warn`)
2. **Skeletons** en `TrackItem` y `PlaylistList` (usar Tailwind `animate-pulse`)
3. **Offline**: mostrar banner si `navigator.onLine === false`; las playlists de Dexie funcionan offline; radio/recs muestran mensaje de conexión requerida
4. **Performance**: usar `v-memo` en listas largas de tracks, `shallowRef` para arrays de tracks en stores
5. **Accesibilidad mínima**: todos los botones con `aria-label`, navegación por teclado en PlayerBar (espacio = play/pause, flechas = seek)
6. **Build check**: `npm run build && npm run preview` — sin errores, sin warnings de TypeScript
7. **Deploy**: Vercel o Netlify → configurar las 6 variables de entorno en el dashboard
8. **Firebase final**: `firebase deploy --only firestore` (rules + indexes)
9. **README.md**: instrucciones de setup, descripción de las 3 APIs necesarias y cómo obtener las claves

**Verificación final (smoke test):**
- Crear playlist desde cero → importar CSV → reproducir → favorito → historial ✓
- Radio Los 40 2005 sem. 20 → generar → reproducir 3 pistas → guardar una en playlist ✓
- Recomendaciones con 5 favoritos → generar → reproducir ✓
- Refrescar página → estado correcto (playlists en Dexie, preferencias en localStorage) ✓
- Abrir en móvil → layout responsivo, PlayerBar usable con el pulgar ✓

---

### Resumen del roadmap

```
FASE 0  Infraestructura y claves              ~1 día
FASE 1  Tipos, DB y Firebase                  ~1 día
FASE 2  Shell de la aplicación                ~1 día
FASE 3  Reproductor YouTube                   ~1 día
FASE 4  Pipeline de enriquecimiento           ~2 días
FASE 5  Playlists completas                   ~2 días   ← milestone: app funcional básica
FASE 6  Modo Radio                            ~2 días   ← milestone: feature estrella
FASE 7  Recomendaciones                       ~2 días
FASE 8  Vistas secundarias                    ~1 día
FASE 9  Calidad y despliegue                  ~1-2 días ← milestone: producción

TOTAL estimado: 14-15 días de desarrollo IA-asistido
```

> **Regla de oro para el AI**: nunca implementar una fase sin que la anterior haya pasado su verificación. Las dependencias son reales — un `trackCache.service.ts` con el bug de Dexie roto hace que las Fases 5-7 funcionen aparentemente pero con datos siempre frescos desde la red.