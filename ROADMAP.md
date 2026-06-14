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

- ~~**Multi-artista seleccionable.**~~ ✓ — [`TrackItem.vue`](src/components/playlist/TrackItem.vue)
  pinta un enlace por artista en colaboraciones. Resuelto por separación del string
  mostrado (helper puro [`splitArtists`](src/utils/artists.ts), con tests), no por
  `artistIds[]`: navega a cada feat. sin tocar la hidratación. **Pendiente opcional:**
  la versión "correcta" vía `track.artistIds[]` del catálogo (más precisa con nombres
  ambiguos), si algún día compensa el plumbing.
- ~~**Sección "Artistas similares" en [`ArtistView`](src/views/ArtistView.vue).**~~ ✓ —
  `useArtist` expone `similar`: primero desde el catálogo (`artist.similar[]`, offline)
  y, si falta o el artista viene de Dexie/Last.fm, vía `getSimilarArtists` (cacheado).
  La ficha pinta chips que enlazan a cada ficha. **Pendiente:** sembrar también las
  **recomendaciones** desde el catálogo para reducir llamadas a Last.fm.
- ~~**Carátulas del top-50 del artista.**~~ ✓ — resuelto cambiando el enfoque. El
  catálogo guarda solo el **top-15** (en vez de 50: `artists.json` 6,1→3,0 MB) y la
  ficha carga el resto **bajo demanda** ("Mostrar más" → Last.fm una vez), cacheando
  en Dexie ([`useArtist.ts`](src/composables/useArtist.ts)). Las carátulas se resuelven
  en runtime y **persisten en Dexie** ([`getTrackCover`](src/services/lastfm.service.ts)),
  así no se re-piden en cada visita. Pre-cachear 50×~2000 portadas era inviable.
- **`mbid` para carátulas robustas.** Se guarda `track.mbid`/`artist.mbid` pero
  [`coverart.service.ts`](src/services/coverart.service.ts) aún busca por texto en
  MusicBrainz. Usar el mbid directo evita ambigüedades y fallos de match.
- ~~**Carátulas de `recursosweb.prisaradio.com` (ORB).**~~ ✓ — re-resueltas en el
  pipeline vía **Deezer** ([`deezer.trackCover`](chart-pipeline/lib/deezer.mjs), URLs
  CORS-friendly): de las 453 ORB + ~117 sin portada, **438 ahora tienen carátula real**
  y **0 quedan con URL ORB muerta** (las que Deezer no encontró caen al placeholder
  limpio). El build futuro lo hace solo (resuelve cover ausente/ORB en
  [`build-charts.mjs`](chart-pipeline/build-charts.mjs)).

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
  marcha ([`chart-pipeline/audit/`](chart-pipeline/audit/)) que detecta los
  embebidos no reproducibles. El fallback de 2.2 ya lo salva en runtime, pero re-resolver
  esos IDs en el bundle estático mejora la experiencia (menos saltos). Tarea de
  datos, no de app.

**Reproducción en móvil (cortes y pantalla apagada).** Ambos problemas nacen de
usar **un único `<iframe>` de YouTube** como fuente de audio. No se plantea, de
momento, dejar YouTube.

- **Corte al pasar de canción** — *parte hecha.* El "silencio → algo → arranca"
  es el **buffering del iframe** al hacer `loadVideoById` del vídeo siguiente
  (un solo iframe no puede tener el próximo listo mientras suena el actual).
  - ✓ *Hecho* (`feat(player): reanuda… y prefetch…`): **prefetch de la siguiente
    pista** ([`usePlayback.ts`](src/composables/usePlayback.ts) → `prefetchNext`)
    para que `next` no espere a la red. Quita la parte variable, **no** el buffering.
  - ⏳ *Pendiente (decisión grande): **doble iframe / gapless.*** Dos players YT:
    mientras suena el A, `cueVideoById(siguiente)` **pre-bufferiza** en el B; al
    dar `next` se cambia al B (ya cargado → casi instantáneo) y se pre-carga el
    nuevo siguiente en el A. Hay que rotar los handlers `onEnded`/`onError` al
    player activo y gestionar prev/aleatorio (no pre-cacheables) y el fallback de
    candidatos. **Riesgo en móvil:** los navegadores limitan media simultáneo y el
    2º iframe podría **no bufferizar en segundo plano** → probar en dispositivo
    real. En escritorio es ganancia segura. Reescribe el núcleo de
    [`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts) (hoy un solo
    `player`). *Nota:* si se añade el **modo clips** (§4), esto pasa de "deseable"
    a casi necesario (los cambios de pista son constantes).
- **Pantalla apagada / segundo plano** — *mitigado; techo de fondo.* YouTube
  **bloquea a propósito** la reproducción en segundo plano en web móvil (empuja
  Premium): al apagar la pantalla, el navegador pausa el iframe. El ancla de audio
  mantiene viva la *sesión* (controles de bloqueo), pero el sonido sale del iframe.
  - ✓ *Hecho:* **reanudación al volver** ([`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts)
    → `resumeIfIntended` + listeners `visibilitychange`/`focus`/`pageshow`, con flag
    `intendedPlaying` para no reanudar lo que pausó el usuario). No suena con la
    pantalla apagada, pero quita el "vuelvo y se ha parado".
  - ❌ *Sin solución limpia:* sonar de verdad en segundo plano exigiría una **fuente
    de audio que no sea el embed de YouTube** (sacar el stream viola los ToS) o un
    Wake Lock que mantenga la pantalla encendida (gasta batería, no es "apagada").
    Descartado para uso personal. Reintentar `playVideo()` en background lo bloquea
    el navegador sin gesto.
- **Registro de pistas no reproducibles** — ✓ *Hecho.* Cuando ningún candidato de
  YouTube arranca (o no hay vídeo), se guarda la pista en la tabla `failedTracks`
  ([`useFailedTracks.ts`](src/composables/useFailedTracks.ts), Dexie v3) con motivo,
  candidatos probados y contador (dedup por `cacheKey`). Así se pueden revisar y
  arreglar después (mejor scoring de candidatos, IDs manuales). `exportFailures()`
  vuelca el registro como JSON para compartirlo.

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
| ~~Baja~~ ✓ | ~~**CI** (GitHub Actions)~~ | Hecho: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) corre audit (prod) + lint + typecheck + test + build en cada push/PR, con `concurrency` que cancela ejecuciones viejas |
| Media | **Completar el catálogo** (tags/duración/oyentes) | Muchos `CatalogTrack` no traen `tags`/`durationMs`/`listeners`. Como el catálogo es **caché terminal** (acierto → `enriched:true` y no vuelve a Last.fm), esas pistas no los obtienen nunca: se ven sin duración ni tags. Enriquecer en [`chart-pipeline/lib/catalog.mjs`](chart-pipeline/lib/catalog.mjs) o no marcarlas como totalmente enriquecidas. Fuente: revisión del estado actual |
| ~~Baja~~ ✓ | ~~**i18n / textos centralizados**~~ | Hecho: `vue-i18n` con 4 locales ([`src/i18n/locales/`](src/i18n/locales/)) es/en/it/fr; idioma del dispositivo por defecto, elección persistida. Todo texto nuevo va a los 4 |

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
| Media (parcial) | **Ficha de artista más rica** | ~~**artistas similares**~~ ✓ (chips que enlazan a cada ficha, desde catálogo→Last.fm, [`useArtist.ts`](src/composables/useArtist.ts)). **Falta:** **álbumes** del artista (`artist.getTopAlbums`) |
| Media | **Ficha de álbum** (`/artist/:name/:album`) | `album.getInfo` → tracklist reproducible reutilizando el `TrackItem` universal. Enlazar desde el buscador y desde la ficha de artista. Bruga la tenía; encaja sin fricción con la arquitectura actual |
| ~~Baja~~ ✓ | ~~**Descubrimiento en Home**~~ | Hecho: estantería "Descubre" en [`HomeView.vue`](src/views/HomeView.vue) con muestra notable del catálogo (`getDiscoveryTracks`, con carátula+oyentes, barajada en cada carga), 100% offline. **Pendiente opcional:** afinar por país/década |
| ~~Baja~~ ✓ | ~~**`document.title` dinámico**~~ | Hecho: "Título — Artista · TuaFM" mientras hay pista cargada; al vaciarse vuelve el título de la ruta ([`App.vue`](src/App.vue) + `routeTitle`) |
| ✅ Hecho | **Modo clips (escucha rápida / skim)** | Botón en la barra que reproduce solo un trozo central de cada canción (15/40/90 s) y auto-avanza → muestrear muchas canciones en poco tiempo. Encaja con el alma "explorar charts". **Implementado — ver abajo.** |

### Modo clips (escucha rápida) — implementado

Un botón en la barra que reproduce solo **un fragmento del centro** de cada
canción y **salta solo** a la siguiente. Útil para "escanear" un Top entero o una
radio rápido (como pasar emisoras).

**Estado (en [`player.store.ts`](src/stores/player.store.ts), persistido):**
- `clipSeconds: 0 | 15 | 40 | 90` — `0` = off (canción completa). Un único botón
  **cicla** `0 → 15 → 40 → 90 → 0`.
- Derivado `clipMode = clipSeconds > 0`.

**Lógica (en [`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts)):** toda
la mecánica del clip vive aquí, donde hay acceso **síncrono** al player y a sus
eventos de estado (antes estaba en un watcher de `usePlayback`, que llegaba tarde
y dejaba oír ruido). El centro se calcula con `clipCentreStart()`
([`utils/clip.ts`](src/utils/clip.ts)): `clamp(duración/2 − clip/2, 0, duración−clip)`.

- **Arranque sin ruido:** el problema era que la pista sonaba desde el segundo 0
  (la intro ya bufferizada) y solo *después* saltaba al centro → se oía un trozo
  de intro + el *glitch* del seek en caliente. Solución: mientras se posiciona el
  clip el player va **muteado** (`armed`); se salta al centro (`seeked`) y solo se
  **desmutea** (`revealClip`) cuando ya suena en el centro, respetando el mute del
  usuario. En el camino *gapless* el standby ya está cueado → la duración se conoce
  al instante → salta **antes** de reproducir (sin intro, casi instantáneo).
- **Fin del clip:** en el ticker, si `currentTime ≥ clipStart + clipSeconds` →
  `onClipEnd` → `next()`. Basado en tiempo real, así respeta pausas.
- **Atrás "rescata" la canción entera:** estando en modo clips, *anterior*
  (`prev`) llama a `playCurrentFull()`: desactiva el recorte **solo para esa
  pista** (`full`) y la reproduce desde el principio; al terminar, las siguientes
  vuelven a sonar en clips. Importante: invalida el preload del standby, porque
  tras una canción entera (minutos) el vídeo cueado está caduco y el swap gapless
  no arrancaría (dejaba el reproductor parado al terminar).

**UI:** botón en [`PlayerBar.vue`](src/components/layout/PlayerBar.vue) (desktop) y
en [`NowPlayingScreen.vue`](src/components/player/NowPlayingScreen.vue) (móvil).
Icono de "clip" + etiqueta del valor (`15s`/`40s`/`90s`) o apagado; `aria-label`
dinámico; resaltado en `brand` cuando activo. Click → cicla `clipSeconds`.

**Casos límite cubiertos:**
- Canción más corta que el clip → `clipCentreStart` satura a `0`; el umbral de
  avance nunca se alcanza → suena entera y avanza por `ENDED`.
- Activar el modo a mitad de pista → `repositionCurrentClip()` recoloca la pista
  que ya suena (también muteando el salto).
- Apagar el modo a mitad de clip → el ticker desmutea y deja terminar la canción.

**Señales de escucha (engagement) — ✓ capturadas:** al SALIR de cada pista se
completa su entrada de historial ([`usePlayHistory.ts`](src/composables/usePlayHistory.ts)
→ `updateEngagement`) con `listenedMs` (tiempo real sonando, acumulado en el ticker,
ignora pausas y los saltos del clip), `durationMs`, `clipSeconds` y `rescued` (atrás
→ entera, señal fuerte de gusto). Aún **no** alimentan las recomendaciones: el
siguiente paso es agregar por artista/tag y ponderar los seeds en
[`recommendations.service.ts`](src/services/recommendations.service.ts).

**Ideas futuras:** sombrear la ventana del clip en la barra de progreso.

**Sinergia/caveat:** cada salto sigue teniendo el **buffering del iframe** (§2).
Como el modo clips cambia de pista constantemente, el corte se nota MÁS → este
modo es el principal argumento para implementar el **doble-iframe gapless** (§2).
Sin gapless funciona, pero entrecortado entre clips.

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
