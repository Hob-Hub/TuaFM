Tengo suficiente para la revisión. Aquí está la auditoría completa.

---

## Revisión crítica del prompt TuaFM v5

---

### BUGS CRÍTICOS — rompen funcionalidad en runtime

#### Bug C1: Contaminación de `id` — corrupción de identidad de pistas en stores ⚠️ Severidad alta

**Dónde:** `trackCache.service.ts` → `_persistToLocal` + `resolveTrack`.

En `_persistToLocal` se hace:
```ts
await db.tracks.put({ ...data, id: cacheKey, ... } as LocalTrack)
```

El `id` del `LocalTrack` se asigna al `cacheKey` (ej. `"radiohead::creep"`). Pero cuando ese objeto se devuelve como `Partial<Track>` desde `resolveTrack` y se pasa a:

```ts
radioStore.updateTrack(track.id, enrichedData)
// que hace: queue[idx] = { ...queue[idx], ...data }
```

El spread del objeto enriquecido sobreescribe `id` del track en la cola de `radiohead::creep` en lugar de su nanoid original. Todos los `updateTrack()` subsiguientes buscan por el nanoid ya no existente → **silencio total, ningún enriquecimiento visible**.

**Fix:** `resolveTrack` no debe incluir `id` en su retorno, o `useTrackEnrich.ts` debe hacer `const { id: _, ...rest } = enriched` antes de llamar a `updateTrack`.

**Consecuencia adicional:** el comentario en `track.types.ts` dice `id: string // nanoid local (efímero)` pero en Dexie el `id` es el `cacheKey` permanente. Contradicción documentada que confunde a un AI builder.

---

#### Bug C2: Last.fm recibe artistas con diacríticos eliminados → misses sistemáticos ⚠️ Severidad alta

**Dónde:** `trackCache.service.ts` → `_fetchExternal(artist, title)` donde `artist = track.artist` (campo normalizado).

El campo `Track.artist` está explícitamente marcado como "normalizado (para cacheKey)". `normalizeStr` elimina diacríticos vía NFD: `"Beyoncé"` → `"beyonce"`, `"Café Quijano"` → `"cafe quijano"`, `"Björk"` → `"bjork"`. Estas strings se pasan directamente a `getTrackInfo(artist, title)`.

Last.fm puede no encontrar ciertos artistas con nombres desnormalizados, especialmente artistas españoles, franceses, escandinavos. El resultado: `enrichError: true` silencioso en millones de tracks del catálogo de Los 40.

El campo `artistDisplay` existe precisamente para esto pero **nunca se usa en llamadas a APIs externas**.

**Fix:** `resolveTrack` debe aceptar un parámetro `displayArtist?: string` y usar `displayArtist ?? artist` para las llamadas a Last.fm/YouTube, reservando `artist` solo para `makeCacheKey`.

**Agravante:** el prompt nunca menciona el parámetro `autocorrect=1` de Last.fm, que mitigaría parcialmente este problema. Debería ser el default en todas las llamadas.

---

### BUGS/OMISIONES OPERATIVAS — funcionalidad rota o degradada

#### Bug O1: Firestore no permite `update` en `track_cache` → YouTubeVideoId permanentemente ausente durante 30 días

**Dónde:** `firestore.rules`.

```
allow update, delete: if false;
```

Si el primer enriquecimiento de un track falla la búsqueda en YouTube Data API (cuota agotada, timeout, etc.), el documento se persiste en Firestore con `youtubeVideoId: null`. Durante los 30 días de TTL, **todos los usuarios** ven ese track como no reproducible, sin posibilidad de corrección. Para un reproductor de música esto es bloqueante.

La regla es deliberada (evitar escrituras maliciosas), pero no documenta ningún mecanismo de mitigación. **Fix sugerido:** permitir `update` si `request.auth != null` y solo para agregar `youtubeVideoId` donde era null, o reducir TTL para tracks sin `youtubeVideoId`.

---

#### Bug O2: Fuentes CSS declaradas pero nunca cargadas

**Dónde:** `src/style.css`.

```css
--font-sans: 'Syne', sans-serif;
--font-body: 'DM Sans', sans-serif;
```

No hay ningún `@import url('https://fonts.googleapis.com/...')` ni enlace en el `<head>`. Las fuentes se declaran pero el navegador hace fallback silencioso a `sans-serif`. El build pasa sin errores pero la app no tiene el look intencional.

---

#### Bug O3: `initialValue: []` → inferencia de tipo `never[]` en `useObservable`

**Dónde:** `useFavorites.ts`, `usePlayHistory.ts`.

```ts
useObservable(from(liveQuery(...)), { initialValue: [] })
```

TypeScript infiere `initialValue` como `never[]`. Cualquier acceso tipado a `favorites.value` antes de la primera emisión dará errores de tipo en el template. **Fix:** `{ initialValue: [] as FavoriteTrack[] }`.

---

### OMISIONES ARQUITECTÓNICAS — el prompt está incompleto como guía de construcción

Este es el problema más serio del prompt como artefacto para un AI builder. La sección §14 ("Instrucciones de construcción") lista un orden de creación de archivos, pero **la mayoría de ellos no están implementados en ninguna parte del prompt**:

| Archivo | Estado en el prompt | Criticidad |
|---|---|---|
| `lastfm.service.ts` | Solo firma en §14, sin código | 🔴 Core |
| `lastfm.similarity.service.ts` | Solo listado, sin código | 🔴 Core (toda la Fase 7 depende) |
| `youtube.service.ts` | Solo firma, sin código | 🔴 Core |
| `coverart.service.ts` | Solo firma, sin código | 🟠 Alta |
| `useTrackEnrich.ts` | Referenciado en 8+ lugares, sin implementar | 🔴 Core |
| `usePlaylists.ts` | CRUD fundamental, sin implementar | 🔴 Core |
| `useCsvImport.ts` | Sin implementar | 🟠 Alta |
| `ui.store.ts` | Listado en §6, sin código | 🟡 Media |
| `App.vue` | Descrito en §15, sin código | 🔴 Core |
| Todos los componentes Vue | Solo `PlayerBar.vue` parcialmente | 🔴 Core |

El prompt describe con precisión los contratos entre estas piezas pero deja su implementación al criterio del AI. Un AI sin contexto previo tendrá que inferir:
- La estructura exacta de las llamadas HTTP a Last.fm (método, parámetros, URL base)
- El manejo de errores de YouTube Data API v3 (códigos 403 quota, estructura JSON de error)
- El CRUD completo de playlists con drag-and-drop y reordenamiento

**Recomendación:** añadir implementaciones de los servicios externos (al menos esqueletos con la URL base correcta y los tipos de respuesta mapeados) y de los composables críticos.

---

### ADVERTENCIAS DE DISEÑO — no rompen pero importan

#### D1: Spark plan + modo radio = bomba de lecturas

Firestore Spark plan incluye 50,000 lecturas/día y 20,000 escrituras/día.

Con Los 40 2004–2025 = ~1,092 períodos semanales. Una generación de radio con ventana de 5 años lee ~260 documentos de `chart_periods`. El límite de lectura se agota con ~192 generaciones/día de todo el sistema. Para uso personal es suficiente. Para un app pública deployada en Vercel/Netlify con usuarios anónimos, el límite se alcanzaría fácilmente.

El prompt no menciona mitigaciones obvias:
- **Firestore offline persistence** (`enableIndexedDbPersistence()`): los chart periods se cachan en IndexedDB automáticamente y se sirven sin leer de red en sesiones repetidas.
- **Caché local de chart periods en Dexie**: si se guardaran los datos del chart generado, una regeneración con mismos parámetros no costaría lecturas.

---

#### D2: `db.tracks.where('cacheKey').equals(cacheKey).first()` es ineficiente

En `_persistToLocal`, `id = cacheKey`. Luego `resolveTrack` usa `.where('cacheKey').equals(cacheKey).first()` (escaneo de índice secundario) cuando podría usar `db.tracks.get(cacheKey)` (lookup por PK, O(log n) en IndexedDB). Menor impacto de performance pero es una inconsistencia que emerge directamente del Bug C1: si `id` fuera el nanoid, el `.where('cacheKey')` sería la forma correcta.

---

#### D3: `onAuthStateChanged` en `ensureAnonymousAuth` nunca se cancela

```ts
onAuthStateChanged(auth, async user => {
  if (!user) await signInAnonymously(auth)
  resolve()
})
```

El listener queda activo después de resolver la Promise. Cada cambio de estado de auth subsiguiente ejecuta `signInAnonymously` si el usuario es null. En la práctica Firebase no revoca auth anónima frecuentemente, pero es un leak técnico. **Fix:** guardar y llamar `unsubscribe()` tras el primer `resolve()`.

---

### VERIFICADO CORRECTO (búsquedas confirmadas)

| Afirmación en el prompt | Estado |
|---|---|
| Tailwind v4: `@theme` en CSS, sin `tailwind.config.js` | ✅ Correcto |
| `pinia-plugin-persistedstate` v4: opción `pick` (no `paths`) | ✅ Correcto (cambio de v3→v4 bien aplicado) |
| `useObservable(from(liveQuery(...)))` — el `from()` es necesario por incompatibilidad de tipos TS entre Dexie Observable y RxJS Observable | ✅ Correcto |
| `toAbsWeek(year, week) = year * 53 + week` — sin colisiones (ISO max week = 53) | ✅ Correcto |
| Firestore query con `chartId ==` + `year >=` + `year <=` en campos distintos | ✅ Válido post-2023 (multiple inequality fields soportado) |
| `firestore.indexes.json` con `chartId ASC + year ASC` para esa query | ✅ Correcto |
| Dexie `EntityTable<T, 'id'>` en v4 | ✅ Correcto |
| Batch limit = 400 < límite Firestore de 500 | ✅ Correcto |
| `dt.weekYear` en Luxon para ISO week year | ✅ Correcto (fix apropiado para semanas limítrofes) |
| `normalizeStr` idéntica en app y script de migración | ✅ Correcto |
| `persistenceScore` aplicado una vez sobre `maxWeeksInList` (no acumulado) | ✅ Fix v5 correcto |

---

### Resumen de prioridad de correcciones

**Antes de usar el prompt para construir:**

1. **Bug C1** — implementar en `useTrackEnrich.ts` que el `id` del enriched data se descarte antes del `updateTrack()`. O mejor: que `resolveTrack` devuelva `Omit<Partial<Track>, 'id'>`.
2. **Bug C2** — añadir parámetro `displayArtist?: string` a `resolveTrack` y usarlo para llamadas externas; añadir `autocorrect=1` como default en todos los wrappers de Last.fm.
3. **Bug O2** — añadir instrucción explícita de cargar `Syne` y `DM Sans` (Google Fonts o auto-hosted).
4. **Omisiones** — implementar al menos los 5 servicios externos y los 3 composables core (`useTrackEnrich`, `usePlaylists`, `useCsvImport`), o añadir una sección §16 con sus esqueletos completos.
5. **D1** — añadir `enableIndexedDbPersistence()` en `firebase/index.ts` y documentar el riesgo de lecturas.

Ahora tengo suficiente para la segunda ronda. Aquí está el informe ampliado:

---

## Segunda ronda de revisión crítica

---

### BUGS DE DEPENDENCIAS — el entorno no compila como está escrito

#### Bug D1: Versión de Vite obsoleta y `@vitejs/plugin-vue` mal versionado ⚠️ Severidad alta

El prompt declara `"vite": "^6.0.0"` y `"@vitejs/plugin-vue": "^5.2.0"`.

**El problema real:** Vite está actualmente en la versión estable 8.0.9 (abril 2026). Un `npm create vite@latest` en junio 2026 genera un proyecto con Vite 8, no Vite 6.

La serie `@vitejs/plugin-vue` v5.x (última: 5.2.4) está diseñada para Vite 5/6. La serie v6.x (última: 6.0.7) añade soporte para Vite 7 y 8.

Resultado: un AI que siga el prompt instalará Vite 6 + plugin-vue v5, mientras un desarrollador humano que use el scaffolding estándar de 2026 tendrá Vite 8 + incompatibilidades.

**Fix:** `"vite": "^8.0.0"` + `"@vitejs/plugin-vue": "^6.0.0"`.

---

#### Bug D2: `@types/youtube` ausente → TypeScript strict falla al compilar ⚠️ Severidad alta

El composable `useYouTubePlayer.ts` usará `window.YT`, `YT.Player`, `YT.PlayerState`, `YT.Events`, etc. El paquete `@types/youtube` (v0.1.2) provee las definiciones TypeScript para la YouTube IFrame API.

Sin él, TypeScript strict (`noImplicitAny: true`) producirá errores en toda referencia a `YT.*` o `window.YT`. El prompt no lo menciona en `devDependencies` ni en ningún paso de instalación.

Esto afecta también a `window.onYouTubeIframeAPIReady`: el callback global que el IFrame API busca en el objeto `window` necesita ser declarado en TypeScript. `@types/youtube` lo declara; sin él, hay que añadir manualmente en `env.d.ts`:
```ts
interface Window {
  YT: typeof YT;
  onYouTubeIframeAPIReady: () => void;
}
```

El prompt no cubre ninguno de los dos caminos.

**Fix:** añadir `"@types/youtube": "^0.1.2"` a `devDependencies` y documentar la declaración de `Window`.

---

#### Bug D3: `satisfies FirestoreTrackCache` explota en TypeScript ⚠️ Severidad media

En `trackCache.service.ts`:
```ts
await setDoc(doc(...), {
  album: data.album ?? null,   // null
  ...
} satisfies FirestoreTrackCache)
```

`FirestoreTrackCache` tiene `album?: string`, que acepta `string | undefined` pero NO `null`. El operador `satisfies` comprueba la compatibilidad estrictamente — `null` no es asignable a `string | undefined` con `strict: true`. Esto produce un error de compilación.

**Fix:** cambiar `FirestoreTrackCache` a usar `string | null` para campos opcionales (lo que Firestore realmente almacena), o eliminar el `satisfies` y tipar con `as FirestoreTrackCache`.

---

### BUGS DE API EXTERNAS — fallan silenciosamente en producción

#### Bug A1: MusicBrainz requiere User-Agent personalizado — imposible desde browser ⚠️ Severidad alta

MusicBrainz aplica rate limits de 1 petición/segundo por IP y 50 peticiones/segundo por User-Agent. Las IPs que superan el límite son bloqueadas temporalmente.

El problema para TuaFM: **los browsers no permiten sobrescribir el header `User-Agent`** en llamadas `fetch()`. Cualquier llamada hecha a `https://musicbrainz.org/ws/2/` desde el browser tendrá el User-Agent del navegador (ej. `Mozilla/5.0...`), que MusicBrainz identifica como acceso no declarado y bloquea con mayor facilidad.

Además, el `coverart.service.ts` requiere dos llamadas encadenadas:
1. `GET https://musicbrainz.org/ws/2/release?query=...` → obtener MBID
2. `GET https://coverartarchive.org/release/{mbid}/front` → imagen

La primera llamada requiere el User-Agent identificado. Sin él, las solicitudes se tratan como scraping anónimo. El prompt dice que `coverart.service.ts` es "solo un fallback", pero la arquitectura asume que funciona.

**Fix real:** o usar un proxy ligero (Cloudflare Worker, Vercel Edge Function) que añada el User-Agent correcto, o eliminarlo como fallback y aceptar que las carátulas solo vienen de Last.fm.

---

#### Bug A2: La YouTube IFrame API requiere `origin` configurado para dominio productivo

El prompt no menciona el parámetro `origin` en `playerVars`. Según la documentación oficial de YouTube IFrame API, cuando la app se sirve desde un dominio real (no `localhost`), las llamadas a la API pueden fallar o el video puede rechazar la reproducción si el `origin` no se especifica. El parámetro correcto en `useYouTubePlayer.ts` (no implementado) debe ser:

```ts
new YT.Player(elementId, {
  playerVars: { origin: window.location.origin }
})
```

Sin esto, en algunos entornos corporativos o con CSP restrictivos, el player se crea pero `playVideo()` no funciona.

---

### BUG DE API FIREBASE — función obsoleta en v11

#### Bug F1: `getFirestore(app)` sin persistencia offline; API de persistencia ha cambiado

El prompt usa:
```ts
export const firestore = getFirestore(app)
```

Esto no configura persistencia offline. La recomendación de la revisión anterior era añadir `enableIndexedDbPersistence()`, pero esa función está deprecated en favor de `persistentLocalCache` con `initializeFirestore`.

El API correcto para Firebase v11:
```ts
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore'

export const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
})
```

Sin esto, cada recarga de la app hace lecturas frescas de Firestore — el Spark plan limit de 50k lecturas/día se consume innecesariamente en cada sesión.

---

### ISSUE DE ARQUITECTURA DEL REPRODUCTOR — race condition no documentada

#### Issue R1: `window.onYouTubeIframeAPIReady` en Vue SPA — race condition clásica no resuelta

En un SPA de Vue 3, el script de YouTube IFrame API se carga dinámicamente (via `document.createElement('script')`). Hay tres estados de carrera posibles que el prompt nunca documenta ni previene para `useYouTubePlayer.ts`:

1. **Caso normal**: el script se carga → se invoca `window.onYouTubeIframeAPIReady` → se instancia `YT.Player`. ✓
2. **Race condition A**: Vue monta el componente antes de que el script descargue → `YT` no definido → `new YT.Player(...)` lanza `ReferenceError`. Silencioso en strict.
3. **Race condition B**: el script ya estaba cargado de una sesión anterior en caché del browser → `onYouTubeIframeAPIReady` nunca se invoca (ya se disparó) → el player nunca se instancia.

La solución estándar para el caso B es verificar `window.YT?.Player` al cargar: si ya existe, instanciar el player directamente sin esperar el callback. El prompt no documenta este patrón en ningún lugar.

---

### INCONSISTENCIAS DE TIPOS — fallan en compilación

#### Tipo T1: `PlayHistoryEntry.id?` con `EntityTable` y el campo `queueMode` tipado demasiado restrictivo

```ts
export interface PlayHistoryEntry {
  id?:  number
  queueMode: 'playlist' | 'radio' | 'recommendations'
}
```

Pero `QueueMode = 'idle' | 'playlist' | 'radio' | 'recommendations'`. En `usePlayHistory.ts`:
```ts
queueMode: mode as 'playlist' | 'radio' | 'recommendations'
```

Este cast es necesario porque `mode: QueueMode` incluye `'idle'`. Pero si `mode` es `'idle'` al llamar `recordPlay` (race condition durante cleanup), el cast silencia el error TypeScript y se persiste `'idle'` en Dexie. Lo correcto es una guarda explícita `if (mode === 'idle') return`.

---

#### Tipo T2: `useObservable` en composables usados fuera de `setup()` context

`useFavorites()` y `usePlayHistory()` usan `useObservable` de `@vueuse/rxjs`, que internamente llama `onUnmounted()` para limpiar la suscripción. Esto requiere que la llamada se haga dentro de `setup()` de un componente Vue.

`useRecommendations.ts` llama `useFavorites()` directamente:
```ts
const { favorites } = useFavorites()
```

Si `useRecommendations` se llama desde `setup()` de un componente, esto funciona. Pero si alguna vez se llamara desde un servicio o un store (cosa que el prompt no hace pero tampoco previene), `useObservable` lanzaría `"getCurrentInstance() is null"`. Correcto como está pero es una trampa arquitectónica no documentada.

---

### PROBLEMAS DE SEGURIDAD — menores pero reales

#### Seg1: API keys expuestas en las instrucciones del prompt

La sección §2 muestra el `.env.local` con `VITE_YOUTUBE_API_KEY=xxx`, etc. Las variables VITE_ se incluyen en el bundle de producción y son visibles en el código fuente del cliente. Esto es el comportamiento esperado de Vite, pero el prompt no menciona la necesidad de:
- Restringir la YouTube API key por HTTP Referer (lo menciona solo en el Paso 7 de Fase 0, en passing)
- Configurar Firebase App Check para proteger Firestore de abuso
- Last.fm API key tampoco tiene restricciones por dominio

Para un app pública, sin App Check y sin restricción de dominios en las API keys, cualquiera que inspeccione el código fuente puede usar las claves para hacer llamadas.

---

### RESUMEN ACUMULADO DE TODOS LOS ISSUES

| # | Categoría | Bug | Severidad | Acción |
|---|---|---|---|---|
| C1 | Bug crítico | `id` contamination: Dexie sobreescribe nanoid de stores | 🔴 Alta | Fix en `resolveTrack` retorno |
| C2 | Bug crítico | Last.fm recibe artista normalizado sin diacríticos | 🔴 Alta | Parámetro `displayArtist` en `resolveTrack` |
| O1 | Operativo | `track_cache` no permite `update` → videoId perdido 30 días | 🟠 Media | Cambiar regla Firestore |
| O2 | Operativo | Fuentes CSS Syne/DM Sans nunca cargadas | 🟠 Media | Añadir Google Fonts |
| O3 | Operativo | `initialValue: []` → `never[]` type inference | 🟡 Menor | Cast explícito |
| D1 | Dependencias | Vite `^6.0.0` + plugin-vue `^5.2.0` obsoletos (actual: Vite 8) | 🔴 Alta | Actualizar a v8/v6 |
| D2 | Dependencias | `@types/youtube` ausente → strict TypeScript no compila | 🔴 Alta | Añadir a devDependencies |
| D3 | Dependencias | `satisfies FirestoreTrackCache` con `null` ≠ `undefined` | 🟠 Media | Arreglar tipo o eliminar satisfies |
| A1 | API externa | MusicBrainz User-Agent inaccesible desde browser → bans | 🔴 Alta | Proxy o eliminar fallback |
| A2 | API externa | YouTube IFrame API sin `origin` param en producción | 🟠 Media | Añadir `origin: window.location.origin` |
| F1 | Firebase | `getFirestore()` sin persistencia offline; API deprecated | 🟠 Media | `initializeFirestore` con `persistentLocalCache` |
| R1 | Reproductor | Race condition clásica YouTube API en SPA no documentada | 🟠 Media | Patrón `window.YT?.Player` |
| T1 | Tipos | `queueMode: 'idle'` puede persistirse sin guarda | 🟡 Menor | Guard explícito |
| T2 | Arquitectura | `useObservable` requiere setup context, no documentado | 🟡 Menor | Nota arquitectónica |
| Seg1 | Seguridad | API keys expuestas sin App Check ni restricción dominio | 🟡 Menor | Documentar mitigaciones |
| OM1–10 | Omisiones | ~10 archivos críticos sin implementar en el prompt | 🔴 Alta | Implementar o esqueletar |
| DA1 | Diseño | Spark plan + radio → límite lecturas con usuarios múltiples | 🟠 Media | `persistentLocalCache` |
| DA2 | Diseño | `allow update: false` → videoId no parcheable 30 días | 🟠 Media | Revisar regla |

**Tres cosas verificadas como correctas que merecen mención:** el patrón `from(liveQuery(...))` es la forma canónica para Vue+Dexie en TypeScript (el `from()` resuelve incompatibilidad de tipos, no es redundante); el `toAbsWeek(year * 53 + week)` es matemáticamente correcto para ISO weeks; la query Firestore con doble rango en `year` + igualdad en `chartId` funciona correctamente con el índice compuesto declarado.