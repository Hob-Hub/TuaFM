# TuaFM

> Tu radio imaginaria, construida desde los charts reales.

Reproductor de música web (Vue 3 + TypeScript) con **memoria histórica**. Tres
modos de escucha sobre una interfaz unificada:

- **Playlist** — tu colección personal. Crea listas o importa CSV (artista, título).
- **Radio** — la máquina del tiempo sonora. Elige una lista (España o Estados Unidos)
  y un año; un algoritmo reconstruye cómo habría sonado la radio ese año, mezclando
  los éxitos del año con clásicos de años cercanos (control de nostalgia).
- **Recomendaciones** — el oráculo de Last.fm a partir de tus favoritos.

Funciona **100% en el navegador**, sin backend propio: audio vía YouTube IFrame,
metadatos de Last.fm, carátulas fallback de MusicBrainz + Cover Art Archive, y
datos de charts servidos como JSON estático local (Firestore opcional como caché
compartida y respaldo).

---

## Stack

Vue 3.5 · Vite 6 · TypeScript strict · Pinia 3 (+persistedstate) · Vue Router 4 ·
Tailwind CSS v4 · Dexie.js 4 (IndexedDB) · Firebase 11 (SDK modular) · VueUse + RxJS ·
Papa Parse · nanoid.

> **Nota de versión:** el prompt original fijaba Pinia `^2.3`, pero
> `pinia-plugin-persistedstate@4` requiere Pinia `>=3`. Se usa **Pinia 3** (API de
> setup stores idéntica). Es la versión estándar para Vue 3.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y rellena las 6 claves (ver abajo)
npm run dev
```

| Comando            | Qué hace                                  |
|--------------------|-------------------------------------------|
| `npm run dev`      | Servidor de desarrollo (Vite)             |
| `npm run build`    | Typecheck (`vue-tsc -b`) + build de prod  |
| `npm run preview`  | Sirve el build de `dist/`                 |
| `npm run typecheck`| Solo comprobación de tipos                |
| `npm run test`     | Tests del núcleo (Vitest)                 |

### Variables de entorno (`.env.local`)

Ninguna es un secreto de servidor: viajan en el bundle del cliente. Protege la
YouTube Data API por *HTTP referer* en Google Cloud y Firestore con sus reglas.

```
VITE_YOUTUBE_API_KEY=      # Google Cloud → YouTube Data API v3
VITE_LASTFM_API_KEY=       # https://www.last.fm/api/account/create
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN= # tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

La app **arranca y muestra la UI aunque falten claves**; los modos que dependen
de cada servicio degradan con un mensaje en lugar de romperse.

> En este repo, `.env.local` ya viene con claves reales de Last.fm y YouTube, y los
> charts viajan como JSON estático en `public/`, así que **los tres modos funcionan
> de inmediato sin Firebase**. Firebase es **opcional**: solo añade la caché de
> enriquecimiento compartida entre usuarios (`track_cache`) y un respaldo de charts.

---

## Firebase

1. Crea un proyecto y habilita **Firestore** y **Authentication → Anónimo**.
2. Despliega reglas e índice (el índice compuesto es obligatorio para el modo radio):

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Colecciones:

| Colección         | Lectura | Escritura                          |
|-------------------|---------|------------------------------------|
| `track_cache`     | pública | con auth (anónima); inmutable      |
| `chart_registry`  | pública | solo scripts de migración (Admin)  |
| `chart_periods`   | pública | solo scripts de migración (Admin)  |

---

## Datos de charts (modo Radio)

La app consume **listas anuales** (un "Top del año" por fuente y año). Cada fuente
nace de una SQLite rica y se **consolida a un Top por año**, puntuando cada canción
por sus posiciones a lo largo del año (`score = Σ 1/√posición`):

- **España** (`es`) ← `los40.db` (semanal: solo Nº1 hasta 2003, top 40 desde 2004).
- **Estados Unidos / Billboard** (`us`) ← `billboard_year_end_hot100.db` (anual, top 100).

El pipeline de datos **versionado** vive en [`chart-pipeline/`](chart-pipeline/)
(el scraper en Python y las `.db` están en `scripts/`, ignorado por git). Genera dos
cosas en `public/` (sin Firebase, offline):

- **`public/charts/`** — listas **compactas**: `registry.json` + `<chartId>.json`,
  donde cada canción es `{t,r,s,p,w}` (referencia al catálogo por `t`=trackId).
- **`public/catalog/`** — catálogo **normalizado y deduplicado**: `tracks.json`
  (1 por canción, con YouTube/carátula de la DB + álbum/tags/duración/oyentes de
  Last.fm) y `artists.json` (bio, imagen, oyentes, tags y **top 50** por artista).
  Es la **primera capa de caché** en runtime → muchas menos llamadas a APIs.

```bash
cd chart-pipeline
node build-charts.mjs              # charts + catálogo enriquecido (Last.fm, resumible)
node build-charts.mjs --no-lastfm  # rápido: solo siembra de la DB, sin tocar la API
```

La consolidación vive en [`chart-pipeline/lib/annualize.mjs`](chart-pipeline/lib/annualize.mjs)
y la normalización del catálogo en [`lib/catalog.mjs`](chart-pipeline/lib/catalog.mjs).
Para subir a Firestore "más adelante" (mismo Top anual, 1 doc/año/chart):

```bash
cd chart-pipeline
npm install                                  # better-sqlite3, firebase-admin
# coloca tu service-account.json de Firebase aquí
node migrate-to-firestore.mjs chart-configs/es.json
node migrate-to-firestore.mjs chart-configs/us.json
```

El scraper que genera/actualiza `los40.db` vive en `scripts/` (Python, ignorado por
git). Ver [`chart-pipeline/README.md`](chart-pipeline/README.md).

### Algoritmo de consolidación (semanal → Top del año)

La SQLite es la fuente rica (semanal en España, anual en Billboard). Para la app se
**aplana a un único Top por año natural**, conservando la información valiosa de las
semanas en una sola puntuación. Para cada canción y año:

```
score(canción, año) = Σ_semanas-del-año  positionScore(posición)
positionScore(p)    = 1 / √p      # Nº1→1.0  Nº2→0.71  Nº3→0.58  Nº10→0.32  Nº40→0.16
```

Se suma sobre todas las semanas en que la canción apareció ese año y se rankea por
`score` descendente. Así el Top del año premia **a la vez** las posiciones de cabeza
(peso fuerte al Nº1/2/3) y la **permanencia** (más semanas = más suma), igual que los
*year-end* reales. Billboard ya es anual: su `score` se deriva del rank con la misma
`positionScore(rank)` para quedar en la misma escala.

Por canción/año se guarda: `score`, `rank` (anual), `peakPosition` (mejor posición
semanal), `weeksOnChart`, y los enlaces (carátula/YouTube) de su **mejor semana**.

**Afinar peak vs permanencia.** El equilibrio lo fija un único punto: `positionScore`
en [`chart-pipeline/lib/annualize.mjs`](chart-pipeline/lib/annualize.mjs). Con `1/√p` (actual) la
permanencia pesa más (una canción de 30 semanas en el top puede superar a un Nº1 de
pocas semanas). Para dar **más peso al pico**, hacerlo más pronunciado: `1/p` o `1/p²`.
Tras cambiarlo hay que **regenerar el bundle** (comandos de arriba). La app usa este
`score` directamente; `positionScore` está duplicado a propósito en
[`src/services/radio.scoring.ts`](src/services/radio.scoring.ts) solo como referencia
del modelo (la app ya no recalcula posiciones).

### Radio: mezcla por años (nostalgia)

Elegido un año de referencia y una fuente, la radio agrega candidatos de los años
≤ referencia dentro de una ventana, ponderando cada canción por
`score × e^(−λ · añosDeDistancia)` y muestreando sin reemplazo (ver
[`radio.scoring.ts`](src/services/radio.scoring.ts) y
[`radio.service.ts`](src/services/radio.service.ts)). El slider de **nostalgia** es λ:
alto ≈ casi solo ese año; bajo ≈ mezcla de épocas. `defaultLambda` y el rango de años
de cada fuente viven en el `registry`.

### Formato del bundle (`public/`)

```jsonc
// charts/registry.json  → ChartRegistry[]  (índice: id, nombre, bandera, años, λ…)
// charts/<chartId>.json → { chartId, periods:[ { year, songs:[ {t,r,s,p,w} ] } ] }  (compacto)
//   t=trackId  r=rank  s=score  p=peakPosition  w=weeksOnChart   (songs[0] = Nº1 del año)
// catalog/tracks.json   → { tracks:  CatalogTrack[]  }   (1 por canción, deduplicado)
// catalog/artists.json  → { artists: CatalogArtist[] }   (bio/imagen/tags/top50)
```

La capa [`src/services/catalog/static.source.ts`](src/services/catalog/static.source.ts)
carga el catálogo y **hidrata** los charts (join por `t`) para reconstruir
`ChartSong`, y es la **caché previa** de [`trackCache.service.ts`](src/services/trackCache.service.ts)
(enriquecimiento de pistas) y [`useArtist.ts`](src/composables/useArtist.ts) (ficha de
artista). Tipos en [`src/types/chart.types.ts`](src/types/chart.types.ts). Lo que no se
encuentra en build se deja vacío y se resuelve lazy al reproducir (p. ej. YouTube de
Billboard).

**Añadir una fuente** = crear `chart-pipeline/chart-configs/<chartId>.json` con su `query`
SQL y `consolidate` (`annual-from-weekly` | `annual`) y regenerar. Cero cambios en el
código de la app: el selector de radio lee el `registry` en runtime.

---

## Arquitectura de datos

```
Bundle estático  public/charts (listas) + public/catalog (tracks/artistas) — fuente primaria, offline
Pinia            estado volátil del player + colas efímeras (radio, recs)
Dexie/IndexedDB  playlists, tracks enriquecidos, favoritos, historial (local, permanente)
Firestore        track_cache compartida + charts — OPCIONAL (respaldo/caché entre usuarios)
```

**Lookup al enriquecer una pista:** Dexie → catálogo estático (`public/catalog`)
→ Firestore `track_cache` (si está configurado) → APIs externas (Last.fm + YouTube +
cover fallback), persistiendo el resultado en las cachés locales. La clave estable es
`cacheKey = normalize(artist)::normalize(title)` (NFD + sin diacríticos), idéntica en
la app y en el pipeline.

**Charts:** se sirven *static-first* desde `public/charts` (ver «Datos de charts»);
Firestore es solo respaldo opcional para fuentes que no estén en el bundle. La app
funciona 100% sin Firebase.

```
src/
  types/        modelos de dominio + DTOs (api.types.ts)
  firebase/     init + auth anónima
  db/           Dexie + normalización/cacheKey
  services/     Last.fm, YouTube, CoverArt, trackCache, radio, recommendations
  stores/       player, ui, radio, recommendations, chartRegistry (Pinia)
  composables/  useYouTubePlayer, usePlayback (orquestador), usePlaylists,
                useFavorites, usePlayHistory, useCsvImport, useTrackEnrich,
                useRadioQueue, useRecommendations, useArtist
  components/   ui/ · player/ · layout/ · playlist/ · radio/
  views/        Home, Playlist, Radio, Recommendations, History, Artist
```

Reglas: los componentes solo importan composables y stores (nunca services);
`resolveTrack()` es la única puerta de enriquecimiento; `TrackItem.vue` es el
componente universal de pista en los tres modos.

---

## Despliegue

Build estático (`dist/`) desplegable en Vercel, Netlify o Cloudflare Pages.
Configura las 6 variables de entorno en el panel del proveedor y
`firebase deploy --only firestore` para reglas e índices.

El routing usa modo *history*, así que necesita un *fallback* a `index.html`
para las rutas profundas. Ya incluido: `public/_redirects` (Netlify / Cloudflare
Pages) y `vercel.json` (Vercel).

Firestore usa **persistencia offline** (`persistentLocalCache`): los datos de
charts leídos se cachean en IndexedDB y no se vuelven a leer de red en sesiones
repetidas — clave para no agotar el límite de lecturas del plan Spark.

Estado del proyecto, decisiones y mejoras pendientes: ver [`ROADMAP.md`](ROADMAP.md).
