# TuaFM — Estado, decisiones y dudas

Documento de alcance tras construir la app y cruzar la auditoría de
`docs/errores_in_prompt.md` con la implementación real, más lo aprendido de la
documentación de Bruga Music (`docs/`) y de búsquedas en internet (junio 2026).

---

## 1. Estado general

La aplicación está **construida y verificada**:

- `npm run build` (incluye `vue-tsc -b`): ✅ sin errores ni avisos
- `npm run test` (Vitest): ✅ 20 tests del núcleo algorítmico
- `npm run dev`: ✅ arranca y sirve
- Clave Last.fm validada con llamada real; query de migración validada contra
  `los40.db` (46.752 entradas, 1.169 semanas, 89% con videoId).

`.env.local` ya lleva las claves de **Last.fm y YouTube** (de `docs/TOKENS.md`),
así que **Playlist, Recomendaciones y Artista funcionan ya**. Solo **Radio**
necesita además crear el proyecto Firebase y correr la migración.

---

## 2. Auditoría cruzada (errores_in_prompt.md → estado real)

### Corregidos en esta ronda

| Id | Problema | Cómo se resolvió |
|----|----------|------------------|
| C1 | Contaminación de `id` al hacer merge del track enriquecido | `resolveTrack` devuelve `EnrichResult = Omit<Partial<Track>,'id'>`; se hace `stripId()` en los hits de Dexie |
| C2 | Last.fm recibía el artista normalizado sin diacríticos | `resolveTrack(artist, title, videoId?, displayArtist?)` usa `displayArtist` (nombre real) para Last.fm/YouTube; `artist` solo para el cacheKey. `autocorrect=1` ya estaba en todas las llamadas |
| O1 / DA2 | `track_cache` no permitía `update` → videoId null 30 días | Regla Firestore: `allow create, update: if request.auth != null` |
| F1 / D1 / DA1 | Sin persistencia offline; lecturas frescas agotan Spark | `initializeFirestore` con `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` |
| D2 (efic.) | `.where('cacheKey').equals().first()` en vez de PK | Ahora `db.tracks.get(cacheKey)` (lookup por PK) |
| — | Imágenes de artista de Last.fm = placeholder "estrella" | `pickImage` filtra los hashes placeholder conocidos → cae al fallback visual |

### Ya estaban resueltos al construir (la auditoría es sobre el *prompt*, no sobre este código)

| Id | Estado en este repo |
|----|---------------------|
| O2 (fuentes Syne/DM Sans) | Cargadas vía `<link>` de Google Fonts en `index.html` |
| O3 (`never[]` en useObservable) | `useObservable<T[], T[]>(...)` con doble genérico |
| D3 (`satisfies` con `null`) | `FirestoreTrackCache` usa `string \| null` en opcionales |
| A2 (YouTube `origin`) | `playerVars.origin = window.location.origin` |
| R1 (race condition YT API en SPA) | `loadApi()` comprueba `window.YT?.Player` y reusa el script existente |
| T1 (`queueMode: 'idle'` persistido) | Guarda `if (mode === 'idle') return` en `recordPlay` |
| D3-ronda1 (listener auth sin cancelar) | `ensureAnonymousAuth` hace `unsub()` tras el primer resultado |
| OM1–10 (≈10 archivos sin implementar) | Todos implementados (services, composables, App.vue, componentes) |

### Diferidos con decisión consciente (ver §4)

A1 (MusicBrainz User-Agent), Seg1 (App Check / restricción de claves),
D1-deps (Vite 6 vs 7/8), D2-deps (`@types/youtube`).

---

## 3. Decisiones tomadas que conviene conocer

1. **Pinia 3, no 2.** El prompt fijaba `pinia ^2.3`, pero
   `pinia-plugin-persistedstate@4` exige `pinia >=3`. La API de setup stores es
   idéntica. (No se usó `--legacy-peer-deps`.)
2. **Carpeta `old/` eliminada.** v1–v4 eran iteraciones superadas íntegramente
   por v5 (PROMPT.md). No aportaban nada no presente ya, mejorado, en v5.
3. **`@types/youtube` no añadido.** Se declararon tipos mínimos propios de
   `YT.Player`/`window.YT` en `useYouTubePlayer.ts`; el build pasa en strict.
4. **MusicBrainz/Cover Art Archive como fallback best-effort.** Ver §4.A1.
5. **Lógica pura extraída** a `utils/normalize.ts`, `utils/csv.ts`,
   `services/radio.scoring.ts` para poder testarla sin Firebase/Dexie.
6. **`.env.local` versionado-localmente** (gitignored) con claves reales de
   Last.fm/YouTube de `docs/TOKENS.md`.

---

## 4. Dudas abiertas / decisiones que son tuyas

### A1 — Carátulas vía MusicBrainz desde el navegador
El navegador no deja fijar `User-Agent`, y MusicBrainz puede limitar/banear por
ello. En la práctica funciona a bajo volumen (memoizado, con `try/catch`, solo
como último recurso cuando Last.fm no trae carátula de álbum). **Opciones:**
(a) dejarlo así (degradación silenciosa a icono); (b) un proxy ligero
(Cloudflare Worker) que añada el UA correcto; (c) eliminarlo y depender solo de
las carátulas de álbum de Last.fm (que sí funcionan).
→ *Recomendación: dejarlo (a) para uso personal; (b) si se hace público.*

### Seg1 — Protección de claves para una app pública
Las `VITE_*` viajan en el bundle (normal en Vite). Para producción pública:
restringe la YouTube key por *HTTP referer* en Google Cloud, y considera
**Firebase App Check** para que `track_cache` no sea escribible por bots.
→ *Para uso personal no es bloqueante.*

### Vite 6 vs 7/8
El build funciona perfecto en **Vite 6.4.3**. Existen Vite 7 (estable) y 8
(Rolldown/Oxc, más nuevo). Subir aporta poco y arriesga incompatibilidades con
Tailwind v4 / plugin-vue. → *Recomendación: quedarse en 6 hasta tener motivo.*

### Plan Firestore (Spark) y modo radio
Con `persistentLocalCache` las regeneraciones repetidas de radio ya no cuestan
lecturas. Si la app fuera pública con muchos usuarios anónimos, valorar cachear
en Dexie los `chart_periods` por (chartId, año) o subir de plan.

---

## 5. Qué falta para un proyecto de este tipo (mejoras recomendadas)

Priorizado. Nada de esto es bloqueante para usar la app; son el siguiente nivel.

| Prioridad | Mejora | Notas |
|-----------|--------|-------|
| Alta | **Migración real a Firestore** | Único paso pendiente para que Radio tenga datos (crear proyecto + correr el script) |
| Media | **PWA instalable** (`vite-plugin-pwa`) | App offline-first; encaja con un reproductor. Bruga lo recomienda |
| Media | **Más tests** | Hoy: núcleo puro (normalize, scoring, csv). Faltan componentes (Vitest + @vue/test-utils) y un e2e (Playwright) del flujo "crear playlist → importar → reproducir" |
| Media | **ESLint + Prettier** | No configurados; útil para consistencia |
| Baja | **CI** (GitHub Actions) | `build` + `test` en cada push |
| Baja | **Validación de respuestas de API** (zod) | Bruga lo sugiere; hoy se confía en los tipos TS |
| Baja | **i18n / textos centralizados** | Hoy en español hardcodeado |
| Baja | **Cancelación de peticiones** (AbortController) | Los servicios ya aceptan `signal`; falta cablearlo en búsquedas que se reescriben rápido |
| Baja | **Mejor selección de videoId de YouTube** | Hoy toma el primer resultado (igual que Bruga); podría filtrar por duración/categoría música |

### Hechos ya, que suelen faltar en estos proyectos
Media Session API (controles de SO/pantalla de bloqueo), persistencia offline,
fallback de routing SPA (`_redirects` + `vercel.json`), code-splitting por
vista, skeletons de carga, banner offline, atajos de teclado, favicon.

---

## 6. Resumen para decidir

- **Para usarla ya (3 modos sin Radio):** nada, ya tienes claves; `npm run dev`.
- **Para activar Radio:** crea Firebase (Firestore + Auth anónima), pon
  `service-account.json` en `scripts/`, y corre la migración.
- **Para publicarla:** mira §4 (App Check, referer, MusicBrainz) y §5 (PWA, CI).
