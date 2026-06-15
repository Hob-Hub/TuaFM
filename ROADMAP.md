# TuaFM — ROADMAP

Solo trabajo **pendiente**. Lo ya hecho vive en el código y en el historial de
git (este documento se limpió para no arrastrar lo cerrado).

Cada punto lleva una línea **Implica** con el coste/ficheros/riesgo aproximado.
Origen: revisión del estado actual + documentos del predecesor
([`docs/DOCUMENTACION.md`](docs/DOCUMENTACION.md),
[`docs/STACK_Y_DESPLIEGUE.md`](docs/STACK_Y_DESPLIEGUE.md)).

---

## 1. Decisiones abiertas (son tuyas)

No son tareas: son elecciones que conviene dejar registradas para no reabrir el
debate. Ninguna bloquea el uso personal.

- **Artwork Last.fm/Deezer.** Las carátulas y fotos de artista priorizan Last.fm
  y usan Deezer como fallback; si no hay imagen fiable, la UI degrada a placeholder.
- **Protección de claves en app pública.** Las `VITE_*` viajan en el bundle. Para
  producción: restringir la YouTube key por *HTTP referer* en Google Cloud; si
  fuese problema, proxy serverless. No bloqueante para uso personal.
- **Vite 6 vs 7/8.** El build va en 6.4.3. Subir aporta poco y arriesga
  incompatibilidades con Tailwind v4 / plugin-vue. → *Quedarse en 6 hasta tener
  motivo.*
- **Host: Vercel vs Cloudflare Pages.** Hoy Vercel/Netlify. Cloudflare Pages es
  mejor opción gratis para SPA estática pura, pero no hay razón para migrar lo que
  funciona. Si se migra, añadir `public/_headers` (ver §4). → *Seguir en Vercel.*

---

## 2. Reproductor — lo que falta

El núcleo (candidatos+scoring, fallback en `onError`, Media Session, prefetch,
reanudación al volver, modo clips, registro de fallos) ya está hecho. Queda:

- **Doble iframe / gapless** *(decisión grande)*. Dos players YT: mientras suena A,
  `cueVideoById(siguiente)` pre-bufferiza en B; al dar `next` se cambia a B (casi
  instantáneo). Elimina el buffering audible entre pistas.
  - **Implica:** reescribir el núcleo de
    [`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts) (hoy un solo
    `player`), rotar handlers `onEnded`/`onError`, gestionar prev/aleatorio y el
    fallback de candidatos. **Riesgo móvil:** los navegadores limitan media
    simultáneo → el 2º iframe podría no bufferizar en segundo plano (probar en
    dispositivo real). En escritorio es ganancia segura. Es el **principal
    habilitador** de un modo clips fluido (hoy entrecortado entre clips).
- **Auditoría de videoId muertos en los charts.** El audit
  ([`chart-pipeline/audit/`](chart-pipeline/audit/)) detecta embebidos no
  reproducibles. El fallback de runtime ya lo salva, pero re-resolver esos IDs en
  el bundle reduce saltos.
  - **Implica:** tarea de datos (pipeline), no de app.

> **Sin solución limpia (descartado):** sonar de verdad con la pantalla apagada
> exigiría una fuente de audio que no sea el embed de YouTube (viola ToS) o un
> Wake Lock que mantenga la pantalla encendida. Fuera de alcance para uso personal.

---

## 3. Datos y recomendaciones

- **Recomendaciones offline-first.** Hoy disparan muchas llamadas a Last.fm. Con
  `similar` + topTracks del catálogo, la mayoría saldría de local (caer a API solo
  si falta). Reduce cuota y latencia.
  - **Implica:** [`recommendations.service.ts`](src/services/recommendations.service.ts);
    el dato (`artist.similar`, 97%) ya está en el catálogo.
- **Engagement → recomendaciones.** Las señales de escucha (`listenedMs`,
  `clipSeconds`, `rescued`) **ya se capturan** en
  [`usePlayHistory.ts`](src/composables/usePlayHistory.ts) pero aún no alimentan
  las recos.
  - **Implica:** agregar por artista/tag y ponderar los seeds en
    [`recommendations.service.ts`](src/services/recommendations.service.ts).
- **Completar el catálogo (tags/duración/oyentes).** Algunos `CatalogTrack` no
  traen `tags`/`durationMs`/`listeners`; como el catálogo es caché terminal
  (`enriched:true` → no vuelve a Last.fm), esas pistas no los obtienen nunca.
  - **Implica:** enriquecer en
    [`chart-pipeline/lib/catalog.mjs`](chart-pipeline/lib/catalog.mjs) o no
    marcarlas como totalmente enriquecidas.
- **Validación de hosts de artwork.** La política actual es Last.fm + Deezer para
  `coverUrl`/`imageUrl`; conviene mantener tests o checks de build que impidan
  reintroducir Prisa/FIMI/SNEP/Cover Art Archive en catálogo, overrides o cachés.
  - **Implica:** test del normalizador y una aserción sobre `public/catalog/*.json`.
- **Tests del pipeline.** [`catalog.mjs`](chart-pipeline/lib/catalog.mjs) (dedup,
  alias, `applyOverrides` con null y aliases) es lógica crítica y hoy **sin tests**;
  un fallo ahí corrompe el catálogo en silencio.
  - **Implica:** suite de tests del pipeline (alto valor, bajo esfuerzo).

---

## 4. Calidad y robustez (técnica)

| Prioridad | Mejora | Implica |
|-----------|--------|---------|
| Media | **Más tests** | Hoy solo núcleo puro. Faltan componentes (Vitest + @vue/test-utils) y un e2e (Playwright) del flujo "crear playlist → importar → reproducir" |
| Media | **Remate ESLint/Prettier** | La config está, pero **sin aplicar al código existente**: (a) `npm run lint:fix`; (b) `npm run format` en commit aislado (Prettier colapsará la alineación manual de columnas) |
| Baja | **Validación de respuestas API (zod)** | Hoy se confía en tipos TS y hay `as any` en [`trackCache.service.ts`](src/services/trackCache.service.ts). Last.fm devuelve objeto-o-array según nº de resultados → zod convierte casts en parsers tipados |
| Baja | **TTLs de caché diferenciados** | Hoy TTL plano de 30 días. Info de track casi no cambia (1 año), búsquedas sí (días) |
| Baja | **Cabeceras de seguridad** (`public/_headers`) | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, CSP si se publica |
| Baja | **tsconfig más estricto** | `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`: útiles con APIs irregulares |

---

## 5. Funcionalidades nuevas (producto)

No son deuda técnica: son producto. Priorizadas por valor/esfuerzo.

- **Ficha de artista: álbumes.** Los artistas similares ya están (chips). Falta la
  sección de álbumes (`artist.getTopAlbums`).
  - **Implica:** [`useArtist.ts`](src/composables/useArtist.ts) +
    [`ArtistView.vue`](src/views/ArtistView.vue).
- **Ficha de álbum** (`/artist/:name/:album`). `album.getInfo` → tracklist
  reproducible reutilizando el `TrackItem` universal. Enlazar desde buscador y
  ficha de artista.
  - **Implica:** nueva ruta + vista; encaja sin fricción con la arquitectura actual.

**Opcionales menores** (si algún día compensan): afinar "Descubre" por
país/década; `track.artistIds[]` preciso para nombres ambiguos (hoy se resuelve
por `splitArtists` del string mostrado); sombrear la ventana del clip en la barra
de progreso; filtros del Top del año por tag/género (los tags ya están).

---

## 6. No rehacer (ya resuelto)

Registrado para no reabrir debates cerrados.

- **Hecho:** reproductor robusto (candidatos+scoring, fallback, Media Session,
  prefetch, reanudación, modo clips, registro de fallos), PWA instalable, CI,
  ESLint/Prettier (config), i18n (es/en/it/fr), AbortController, descubrimiento en
  Home, `document.title` dinámico, multi-artista navegable, artistas similares,
  artwork Last.fm/Deezer, dedup del catálogo, `artistIds[]` al 100%.
- **Patrones ya aplicados:** IDs estables (`nanoid`+`cacheKey`) en vez de índices;
  `URL`/`URLSearchParams`; loader oficial del iframe API; sanitización de hosts
  de artwork; caché con TTL + `try/catch`; TypeScript strict + tests de lógica pura.
- **NO adoptar:** TanStack Query (la caché propia Dexie→catálogo→API es más
  deliberada; duplicaría responsabilidades) ni idb-keyval (Dexie es superior para
  este modelo de datos).
