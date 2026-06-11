# TuaFM — ROADMAP

Decisiones abiertas y mejoras pendientes. Lo ya aplicado se omite: vive en el
código y en el historial de git.

Parte de este roadmap nace de revisar los documentos del proyecto predecesor
([`docs/DOCUMENTACION.md`](docs/DOCUMENTACION.md) y
[`docs/STACK_Y_DESPLIEGUE.md`](docs/STACK_Y_DESPLIEGUE.md), la antigua *Bruga
Music* en Vue 2/Vuex). TuaFM ya internalizó la mayoría de sus lecciones (IDs
estables en vez de índices, `URLSearchParams`, loader oficial del iframe,
MusicBrainz + Cover Art Archive, caché con TTL, TypeScript strict, tests de
lógica). Lo que sigue es lo que **aún no** cubre, más la lista que ya estaba
aquí, integrada y re-priorizada.

---

## 0. Aprovechar el catálogo local en la UI (pendiente reciente)

El catálogo (`public/catalog/{tracks,artists}.json`) ya guarda datos que la UI
**todavía no surfacea**. Por orden de valor:

- **Multi-artista seleccionable.** Hoy [`TrackItem.vue`](src/components/playlist/TrackItem.vue)
  enlaza el string completo (`artistDisplay`, p. ej. "David Guetta, Akon") a una
  única ficha de artista → para colaboraciones el enlace no resuelve. El catálogo ya
  tiene `track.artistIds[]` y cada colaborador su entrada. **Falta:** llevar la lista
  de artistas hasta `Track` (vía hidratación + `candidateToTrack`) y que `TrackItem`
  pinte un enlace por artista. Habilita navegar a cada feat.
- **Sección "Artistas similares" en [`ArtistView`](src/views/ArtistView.vue).** El
  catálogo guarda `artist.similar[]`, pero `useArtist` no lo expone ni se muestra.
  Además, las **recomendaciones** ([`recommendations.service.ts`](src/services/recommendations.service.ts))
  pegan a Last.fm en runtime: podrían sembrarse desde `similar`/`topTracks` del
  catálogo y reducir llamadas (caer a la API solo si falta).
- **Carátulas del top-50 del artista.** En `ArtistView` el top viene de Last.fm (solo
  títulos) y son éxitos *globales*, muchos fuera de nuestro catálogo → se resuelven en
  runtime y algunos no traen carátula (huecos visibles). Pre-cachear 50×~2000 portadas
  es inviable (~100k llamadas). *Opción:* usar como fallback la foto del artista (o la
  carátula de Deezer del track) en vez de dejar el hueco.
- **`mbid` para carátulas robustas.** Se guarda `track.mbid`/`artist.mbid` pero
  [`coverart.service.ts`](src/services/coverart.service.ts) aún busca por texto en
  MusicBrainz. Usar el mbid directo evita ambigüedades y fallos de match.
- **Carátulas de `recursosweb.prisaradio.com` (ORB).** ~453 pistas del catálogo
  (~10%) traen `coverUrl` de prisaradio, que el navegador **bloquea por ORB**
  (Opaque Response Blocking: responde sin content-type/CORS válidos) → nunca
  pintan. Runtime ya degrada limpio: [`TrackCover.vue`](src/components/ui/TrackCover.vue)
  las descarta de entrada y muestra el placeholder con inicial. **Falta el arreglo
  de fondo:** re-resolver esas carátulas en `chart-pipeline` con Last.fm/Cover Art
  Archive (como el otro ~90%) y volcarlas al catálogo, para que tengan portada real.

---

## 1. Decisiones abiertas (son tuyas)

### Carátulas vía MusicBrainz desde el navegador
El navegador no deja fijar `User-Agent` y MusicBrainz puede limitar/banear por
ello. Hoy funciona a bajo volumen (memoizado, con `try/catch`, solo como último
recurso cuando Last.fm no trae carátula de álbum). **Opciones:** (a) dejarlo así
(degradación a icono); (b) un proxy ligero (Cloudflare Worker) que añada el UA
correcto; (c) depender solo de las carátulas de álbum de Last.fm.
→ *Recomendación: (a) para uso personal; (b) si se hace público.*

### Protección de claves para una app pública
Las `VITE_*` viajan en el bundle (normal en Vite). Para producción pública:
restringe la YouTube key por *HTTP referer* en Google Cloud. Si algún día la
exposición de claves fuese un problema, la vía es un proxy serverless (p. ej.
Vercel Functions) que las mantenga del lado servidor. Para uso personal no es
bloqueante.

> **Dato a tener presente (corrige al PROMPT/README):** el PROMPT y el README
> dicen que la YouTube Data API da *"10k ud/día"*, pero `search.list` cuesta
> **100 unidades por llamada** → ~100 búsquedas/día reales en free tier. El
> código ya lo refleja en [`youtube.service.ts`](src/services/youtube.service.ts),
> pero conviene corregir la documentación. Esto es lo que hace que cachear sea
> **obligatorio**, no opcional (fuente: `docs/STACK_Y_DESPLIEGUE.md`, sección
> *YouTube Search*).

### Vite 6 vs 7/8
El build funciona en **Vite 6.4.3**. Existen Vite 7 (estable) y 8 (Rolldown/Oxc).
Subir aporta poco y arriesga incompatibilidades con Tailwind v4 / plugin-vue.
→ *Recomendación: quedarse en 6 hasta tener motivo.*

### Host de despliegue: Vercel vs Cloudflare Pages
Hoy se apunta a Vercel/Netlify (hay `vercel.json` y `public/_redirects`). El
análisis de stack recomienda **Cloudflare Pages** como mejor opción gratis para
una SPA estática pura (assets ilimitados, fallback SPA automático, 500
builds/mes). No es razón para migrar lo que ya funciona, pero es la alternativa
a considerar si el tráfico crece. Si se migra, añadir `public/_headers` con
cabeceras de seguridad (ver §3).
→ *Recomendación: seguir en Vercel; reevaluar solo si hace falta.*

---

## 2. Endurecer el reproductor (riesgo nº1: YouTube) — ✓ HECHO

Ambos documentos del predecesor coinciden en que **el mayor riesgo de una app
así no es el framework, es YouTube**: cuota, matching incorrecto, vídeos no
embebibles y errores del iframe. Resuelto en el commit `feat(player): candidatos
de YouTube con scoring y fallback en error de reproducción` (`4f916a5`):

- **2.1 Candidatos + scoring** ✓ — `searchVideoCandidates` pide 5 resultados y
  los rankea en [`youtube.scoring.ts`](src/services/youtube.scoring.ts): premia
  artista/título, "official audio" y canal Topic; penaliza cover/karaoke/remix/
  live no pedidos (determinista y estable). Los candidatos se cachean (campo
  `youtubeCandidates` en Dexie) sin coste extra de cuota. Cubierto
  por [`youtube.scoring.test.ts`](src/services/youtube.scoring.test.ts).
- **2.2 Fallback en `onError`** ✓ — el iframe ya no muere: reintenta el
  siguiente candidato y, si se agotan, salta de pista
  ([`usePlayback.ts`](src/composables/usePlayback.ts) →
  `handlePlaybackError`). Vale también para radio (cuyos videoId embebidos a
  veces están muertos).
- **2.3 Media Session API** ✓ — ya estaba: metadatos + controles del SO
  (`updateMediaSession` en [`usePlayback.ts`](src/composables/usePlayback.ts)).

**Remate de esta área:**
- **Controles de medios del SO** ✓ — `playbackState` (play/pause), `positionState`
  (barra de progreso) y handlers de *seek* (seekto/seekbackward/seekforward)
  cableados en [`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts) y
  [`usePlayback.ts`](src/composables/usePlayback.ts).
- **Auditoría de videoId muertos en los charts** (pendiente): hay un audit en
  marcha (`chart-pipeline` / `youtube_audit_*`) que detecta los embebidos no
  reproducibles. El fallback de 2.2 ya lo salva en runtime, pero re-resolver
  esos IDs en el bundle estático mejora la experiencia (menos saltos). Tarea de
  datos, no de app.

---

## 3. Mejoras pendientes (priorizadas)

| Prioridad | Mejora | Notas |
|-----------|--------|-------|
| ~~Media~~ ✓ | ~~**PWA instalable**~~ (`vite-plugin-pwa`) | Hecho: manifest + service worker (Workbox). `registerType: 'prompt'` a propósito (es un reproductor → no auto-recarga a media canción; toast "Recargar" en [`PwaUpdatePrompt.vue`](src/components/ui/PwaUpdatePrompt.vue)). Precache solo del shell (~690 KiB); catálogo/charts (8 MB) por **StaleWhileRevalidate** en runtime, fonts CacheFirst, carátulas CacheFirst. YouTube (iframe) sin regla a propósito. El SW solo corre en `build`/`preview`, no en `dev` |
| Media | **Más tests** | Hoy: núcleo puro (normalize, scoring, csv, youtube.scoring). Faltan componentes (Vitest + @vue/test-utils) y un e2e (Playwright) del flujo "crear playlist → importar → reproducir" |
| ~~Media~~ ✓ | ~~**ESLint + Prettier**~~ | Hecho: flat config (`eslint.config.js`) + `.prettierrc.json` + scripts `lint`/`format`. **Falta el remate** (ver abajo): correr `lint:fix`/`format` sobre el código existente y limpiar la deuda de lint que aflora |
| Baja | **Validación de respuestas de API** (zod) | Hoy se confía en los tipos TS y hay `as any` en [`trackCache.service.ts`](src/services/trackCache.service.ts). Last.fm devuelve objeto-o-array según nº de resultados y campos que faltan: zod convierte esos casts en parsers tipados |
| ~~Baja~~ ✓ | ~~**Cancelación de peticiones**~~ (AbortController) | Hecho en el buscador global ([`SearchView.vue`](src/views/SearchView.vue)) y en [`AddTrackModal.vue`](src/components/playlist/AddTrackModal.vue): cada búsqueda aborta la anterior con guard `signal.aborted` |
| Baja | **TTLs de caché diferenciados** | Hoy la caché de tracks en Dexie usa un TTL plano de 30 días. Info de track casi no cambia (1 año), búsquedas sí (días). El predecesor ya tenía TTLs por tipo de dato |
| Baja | **Cabeceras de seguridad** (`public/_headers`) | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, y CSP si se publica. Portable a Vercel/Netlify con variantes |
| Baja | **tsconfig más estricto** | `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`: muy útiles con APIs irregulares |
| Baja | **CI** (GitHub Actions) | `build` + `test` (+ `lint`) en cada push. Ahora que hay lint, blinda el refactor en curso |
| Media | **Completar el catálogo** (tags/duración/oyentes) | Muchos `CatalogTrack` no traen `tags`/`durationMs`/`listeners`. Como el catálogo es **caché terminal** (acierto → `enriched:true` y no vuelve a Last.fm), esas pistas no los obtienen nunca: se ven sin duración ni tags. Enriquecer en [`chart-pipeline/lib/catalog.mjs`](chart-pipeline/lib/catalog.mjs) o no marcarlas como totalmente enriquecidas. Fuente: revisión del estado actual |
| Baja | **i18n / textos centralizados** | Hoy en español hardcodeado |

> **Remate de ESLint/Prettier:** la config está puesta pero **no se ha aplicado
> al código existente**. Pendiente: (a) `npm run lint:fix` para la deuda
> auto-corregible; (b) decidir si pasar `npm run format` (Prettier **colapsará la
> alineación manual de columnas** del código actual, así que conviene hacerlo en
> un commit aislado y de una vez, no mezclado con cambios funcionales).

---

## 4. Funcionalidades nuevas (del predecesor y oportunidades)

Ideas de *Bruga Music* y propias que TuaFM aún no tiene. No son deuda técnica:
son **producto**. Priorizadas por relación valor/esfuerzo.

| Prioridad | Funcionalidad | Notas |
|-----------|---------------|-------|
| Media | **Ficha de artista más rica** | Hoy: bio + top tracks. Añadir **artistas similares** (ya existe `getSimilarArtists` en [`lastfm.similarity.service.ts`](src/services/lastfm.similarity.service.ts) → coste casi nulo) y **álbumes** del artista (`artist.getTopAlbums`). Los similares enlazan la exploración con el modo Recomendaciones |
| Media | **Ficha de álbum** (`/artist/:name/:album`) | `album.getInfo` → tracklist reproducible reutilizando el `TrackItem` universal. Enlazar desde el buscador y desde la ficha de artista. Bruga la tenía; encaja sin fricción con la arquitectura actual |
| Baja | **Descubrimiento en Home** | Sección de artistas/canciones destacadas. Oportunidad propia: servirlo **offline desde el catálogo** (top artistas/canciones de los charts, por país o década) en lugar de `geo.gettopartists` → cero coste de API y coherente con el alma "memoria histórica" de TuaFM |
| Baja | **`document.title` dinámico** | "Título — Artista · TuaFM" mientras suena (Bruga lo hacía). Complementa la Media Session API ya integrada |

---

## 5. Lecciones del predecesor — ya aplicadas (no rehacer)

Registrado para no reabrir debates ya cerrados. TuaFM ya hace bien lo que
*Bruga Music* hacía mal:

- **IDs estables en vez de índices** para la cola/favoritos (Bruga usaba
  `playing: number` y se rompía al borrar). TuaFM: `nanoid` + `cacheKey`.
- **`URL`/`URLSearchParams`** en lugar de concatenar strings.
- **Loader oficial** `youtube.com/iframe_api`, no una URL versionada de
  `www-widgetapi` (que en Bruga podía romperse sin aviso).
- **Carátulas de álbum:** MusicBrainz + Cover Art Archive como fallback, no el
  hack de thumbnails de Bing.
- **Imágenes de artista:** Deezer en el build
  ([`chart-pipeline/lib/deezer.mjs`](chart-pipeline/lib/deezer.mjs)), porque Last.fm
  dejó de servir fotos de artista. Mejor que el hack de Bing del predecesor.
- **Caché con TTL**, `try/catch` y estados de error en las llamadas.
- **TypeScript strict** y tests de la lógica pura (adaptadores/scoring/CSV).

### Lo que el stack doc sugería pero NO conviene adoptar
- **TanStack Query:** pensado para apps *sin* capa de caché propia. La
  arquitectura de caché de TuaFM (Dexie → catálogo estático → APIs) es más
  deliberada; meter TanStack duplicaría responsabilidades.
- **idb-keyval:** TuaFM usa Dexie, que es superior para su modelo de datos.

---

## 6. Origen de cada idea

| Sección | Fuente |
|---------|--------|
| §1 (carátulas, claves, Vite) | Decisiones propias previas de TuaFM |
| §1 (host, cuota YouTube) | `docs/STACK_Y_DESPLIEGUE.md` |
| §2 (candidatos, onError, Media Session) — ✓ hecho | `docs/DOCUMENTACION.md` (problemas 4-5, reproductor propuesto) + `docs/STACK_Y_DESPLIEGUE.md` (YouTube Search/Player) |
| §3 (PWA, tests, ESLint, zod, AbortController, i18n) | Ya estaban en `dudas.md` |
| §3 (TTLs, cabeceras, tsconfig) | `docs/STACK_Y_DESPLIEGUE.md` + `docs/DOCUMENTACION.md` |
| §3 (completar catálogo) | Revisión del estado actual |
| §4 (ficha artista/álbum, Home, title) | `docs/DOCUMENTACION.md` (features de Bruga) + oportunidades propias |
| §5 | Comparativa código actual vs `docs/` |
