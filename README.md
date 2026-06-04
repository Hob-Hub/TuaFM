# TuaFM

> Tu radio imaginaria, construida desde los charts reales.

Reproductor de música web (Vue 3 + TypeScript) con **memoria histórica**. Tres
modos de escucha sobre una interfaz unificada:

- **Playlist** — tu colección personal. Crea listas o importa CSV (artista, título).
- **Radio** — la máquina del tiempo sonora. Elige fuente, año y semana; un algoritmo
  reconstruye cómo habría sonado la radio esa semana (hits + clásicos que seguían pinchándose).
- **Recomendaciones** — el oráculo de Last.fm a partir de tus favoritos.

Funciona **100% en el navegador**, sin backend propio: audio vía YouTube IFrame,
metadatos de Last.fm, carátulas fallback de MusicBrainz + Cover Art Archive, y
caché compartida + datos de charts en Firebase Firestore.

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

> En este repo, `.env.local` ya viene con claves reales de Last.fm y YouTube,
> así que **Playlist, Recomendaciones y Artista funcionan de inmediato**.
> Solo **Radio** necesita las 4 variables de Firebase.

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

Los datos de Los 40 ya están en `los40.db` (SQLite, 2004–2026, ~1.165 listas de 40).
También se puede generar `billboard_year_end_hot100.db` con el histórico anual
Billboard Year-End Hot 100 (1958–último año cerrado).

Para subir una fuente a Firestore:

```bash
cd scripts
npm install                                  # firebase-admin, better-sqlite3, luxon
# coloca tu service-account.json de Firebase aquí
node migrate-to-firestore.mjs chart-configs/los40_es.json
node migrate-to-firestore.mjs chart-configs/billboard_year_end_hot100.json
```

El scraper que genera/actualiza `los40.db` vive en `scripts/` (Python). Ver
[`scripts/README.md`](scripts/README.md).

**Añadir una nueva fuente de charts** = crear `scripts/chart-configs/<chartId>.json`
y ejecutar el script. Cero cambios en el código de la app (el selector de radio
lee `chart_registry` en tiempo de ejecución). Hay una plantilla en
`chart-configs/billboard_hot100.json`.

---

## Arquitectura (tres capas de datos)

```
Pinia            estado volátil del player + colas efímeras (radio, recs)
Dexie/IndexedDB  playlists, tracks enriquecidos, favoritos, historial (local, permanente)
Firestore        track_cache (compartida) + chart_registry/chart_periods (charts)
```

**Lookup al reproducir:** Dexie → Firestore `track_cache` → APIs externas
(Last.fm + YouTube + cover fallback), persistiendo el resultado en ambas cachés.
La clave estable de una canción es `cacheKey = normalize(artist)::normalize(title)`
(NFD + sin diacríticos), idéntica en la app y en el script de migración.

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

Estado del proyecto, decisiones y mejoras pendientes: ver [`dudas.md`](dudas.md).
