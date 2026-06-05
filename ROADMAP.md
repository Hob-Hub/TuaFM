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
restringe la YouTube key por *HTTP referer* en Google Cloud y, si usas Firestore,
considera **Firebase App Check** para que `track_cache` no sea escribible por
bots. Para uso personal no es bloqueante.

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

## 2. Endurecer el reproductor (riesgo nº1: YouTube)

Ambos documentos del predecesor coinciden en que **el mayor riesgo de una app
así no es el framework, es YouTube**: cuota, matching incorrecto, vídeos no
embebibles y errores del iframe. Aquí TuaFM es hoy más optimista de lo que
debería. Estas tres mejoras se refuerzan entre sí y atacan ese riesgo:

### 2.1. Selección de vídeo con candidatos + scoring
**Estado:** [`youtube.service.ts`](src/services/youtube.service.ts) pide
`maxResults=1` y se queda con el primer resultado (ya usa `type=video` y
`videoEmbeddable=true` ✓).
**Mejora:** pedir 4-5 candidatos y puntuarlos antes de elegir. Scoring simple
(de `docs/STACK_Y_DESPLIEGUE.md`):
```
+ artista aparece en título/canal
+ título contiene el título de la canción
+ título contiene "official audio"
+ canal contiene "topic" u "official"
− título contiene "cover" / "karaoke"
− "remix" o "live" si la canción pedida no los contiene
```
Como el resultado ya se cachea (Dexie + Firestore), el coste extra de cuota es
nulo: una sola búsqueda devuelve los 5 candidatos. Guardar los candidatos (no
solo el ganador) habilita 2.2.

### 2.2. Fallback en `onError` del iframe
**Estado:** [`useYouTubePlayer.ts`](src/composables/useYouTubePlayer.ts) hace
`onError → state = 'error'` y se queda ahí.
**Mejora:** ante vídeo privado / no-embebible / bloqueado regional / error
HTML5, no morir: probar el **siguiente candidato** (de 2.1) y, si se agotan,
**saltar de pista** automáticamente. Es la diferencia entre "el reproductor se
cuelga" y "la cola sigue sonando". Reutiliza los candidatos cacheados en 2.1.

### 2.3. Media Session API
**Estado:** no implementado.
**Mejora:** integrar `navigator.mediaSession` para exponer metadatos (título,
artista, carátula) y controles (play/pause/anterior/siguiente) en la pantalla
de bloqueo, auriculares y notificación del SO. Alto valor para un reproductor,
sobre todo en móvil. Encaja en [`usePlayback.ts`](src/composables/usePlayback.ts).
*Nota:* en móvil YouTube pausa al ocultar la pestaña; Media Session mitiga la UX
pero no elimina del todo esa limitación de plataforma. El predecesor usaba un
hack (`stopImmediatePropagation`) que su propia doc marca como frágil — **no
copiarlo**.

---

## 3. Mejoras pendientes (priorizadas)

| Prioridad | Mejora | Notas |
|-----------|--------|-------|
| Media | **PWA instalable** (`vite-plugin-pwa`) | App offline-first; encaja con un reproductor. Tus playlists de Dexie ya funcionan sin red → el shell offline cierra el círculo |
| Media | **Más tests** | Hoy: núcleo puro (normalize, scoring, csv). Faltan componentes (Vitest + @vue/test-utils) y un e2e (Playwright) del flujo "crear playlist → importar → reproducir" |
| Media | **ESLint + Prettier** | No configurados |
| Baja | **Validación de respuestas de API** (zod) | Hoy se confía en los tipos TS y hay `as any` en [`trackCache.service.ts`](src/services/trackCache.service.ts). Last.fm devuelve objeto-o-array según nº de resultados y campos que faltan: zod convierte esos casts en parsers tipados |
| Baja | **Cancelación de peticiones** (AbortController) | Los servicios ya aceptan `signal`; falta cablearlo en búsquedas que se reescriben rápido (p.ej. `AddTrackModal`) |
| Baja | **TTLs de caché diferenciados** | Hoy `track_cache` usa un TTL plano de 30 días. Info de track casi no cambia (1 año), búsquedas sí (días). El predecesor ya tenía TTLs por tipo de dato |
| Baja | **Cabeceras de seguridad** (`public/_headers`) | `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, y CSP si se publica. Portable a Vercel/Netlify con variantes |
| Baja | **tsconfig más estricto** | `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`: muy útiles con APIs irregulares |
| Baja | **CI** (GitHub Actions) | `build` + `test` en cada push |
| Baja | **i18n / textos centralizados** | Hoy en español hardcodeado |

---

## 4. Lecciones del predecesor — ya aplicadas (no rehacer)

Registrado para no reabrir debates ya cerrados. TuaFM ya hace bien lo que
*Bruga Music* hacía mal:

- **IDs estables en vez de índices** para la cola/favoritos (Bruga usaba
  `playing: number` y se rompía al borrar). TuaFM: `nanoid` + `cacheKey`.
- **`URL`/`URLSearchParams`** en lugar de concatenar strings.
- **Loader oficial** `youtube.com/iframe_api`, no una URL versionada de
  `www-widgetapi` (que en Bruga podía romperse sin aviso).
- **Carátulas:** MusicBrainz + Cover Art Archive como fallback, no el hack de
  thumbnails de Bing.
- **Caché con TTL**, `try/catch` y estados de error en las llamadas.
- **TypeScript strict** y tests de la lógica pura (adaptadores/scoring/CSV).

### Lo que el stack doc sugería pero NO conviene adoptar
- **TanStack Query:** pensado para apps *sin* capa de caché propia. La
  arquitectura de 3 capas de TuaFM (Dexie → Firestore `track_cache` → APIs) es
  más deliberada; meter TanStack duplicaría responsabilidades.
- **idb-keyval:** TuaFM usa Dexie, que es superior para su modelo de datos.

---

## 5. Origen de cada idea

| Sección | Fuente |
|---------|--------|
| §1 (carátulas, claves, Vite) | Decisiones propias previas de TuaFM |
| §1 (host, cuota YouTube) | `docs/STACK_Y_DESPLIEGUE.md` |
| §2 (candidatos, onError, Media Session) | `docs/DOCUMENTACION.md` (problemas 4-5, reproductor propuesto) + `docs/STACK_Y_DESPLIEGUE.md` (YouTube Search/Player) |
| §3 (PWA, tests, ESLint, zod, AbortController, i18n) | Ya estaban en `dudas.md` |
| §3 (TTLs, cabeceras, tsconfig) | `docs/STACK_Y_DESPLIEGUE.md` + `docs/DOCUMENTACION.md` |
| §4 | Comparativa código actual vs `docs/` |
