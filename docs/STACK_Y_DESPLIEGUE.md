# Mejor stack y despliegue gratis para rehacer Bruga Music

Fecha de analisis: 2026-06-04.

Objetivo: rehacer Bruga Music desde cero con el mejor frontend posible hoy, sin backend propio.

## Decision corta

La mejor opcion para esta app hoy es:

```text
Vue 3 + Vite + TypeScript + Pinia + TanStack Vue Query + Vue Router + IndexedDB + YouTube IFrame API + Cloudflare Pages
```

Despliegue gratis recomendado:

```text
Cloudflare Pages
```

Por que:

- La app es una SPA musical, no necesita SSR.
- No quieres backend.
- Vite es el build tool recomendado para Vue 3 y genera assets estaticos optimizados.
- Vue 3 mantiene continuidad con el proyecto actual, pero moderniza la base.
- Pinia sustituye bien a Vuex para estado local.
- TanStack Query encaja mejor que meter llamadas remotas en Pinia.
- Cloudflare Pages es el mejor hosting gratis para SPA estatica: static assets gratis e ilimitados, 500 builds/mes y fallback SPA automatico si no hay `404.html`.

## Lo que no haria

No usaria:

- `Vue 2`: esta app merece rehacerse ya en Vue 3.
- `Webpack` manual: no aporta nada frente a Vite para este caso.
- `Nuxt`, `Next`, `Remix` o SSR: no quieres backend y la app no necesita renderizado servidor.
- `Firebase Hosting` como primera opcion: es viable, pero Cloudflare Pages encaja mejor para una SPA estatica publica.
- `Netlify` como primera opcion: desde sus planes nuevos, el modelo de creditos es menos claro y menos generoso para proyectos gratis.
- `GitHub Pages` como primera opcion: funciona, pero el soporte de rutas SPA es peor y tiene limites mas visibles.
- Un proxy serverless "solo para ocultar keys": eso ya es backend. Si no quieres backend, asume que las claves publicas de frontend son visibles y restringelas por dominio/cuota.

## Stack recomendado

### Framework

```text
Vue 3
```

Motivos:

- Ya tienes la aplicacion modelada en componentes Vue.
- La logica actual de rutas, player, playlist y tarjetas migra de forma natural.
- Vue 3 con Composition API y `<script setup>` reduce mucho boilerplate.
- El ecosistema oficial recomienda Vite como toolchain y Pinia como estado para Vue 3.

Fuente: la guia de migracion de Vue recomienda Vite como build toolchain y Pinia como solucion de estado a gran escala para Vue 3.

### Build tool

```text
Vite
```

Motivos:

- Dev server muy rapido.
- Build de produccion para assets estaticos.
- Soporta plantillas `vue-ts` oficialmente.
- Evita configurar loaders manuales para Vue, CSS, assets, etc.
- Encaja perfecto con Cloudflare Pages, Vercel, Netlify y GitHub Pages.

Comando de creacion recomendado:

```bash
pnpm create vite bruga-music-next --template vue-ts
```

Alternativa si prefieres el scaffold oficial de Vue:

```bash
pnpm create vue@latest bruga-music-next
```

### Lenguaje

```text
TypeScript strict
```

Motivos:

- Las respuestas de Last.fm y YouTube son irregulares.
- Evita bugs de `undefined`, ids inexistentes y campos opcionales.
- Ayuda a separar modelos externos de modelos internos.

Configuracion base:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### Router

```text
Vue Router 4
```

Rutas recomendadas:

```text
/                         Home: top artists + search
/search/:type             Resultados con query param q
/artist/:artistName       Ficha artista
/album/:artistName/:album Ficha album
/playlist                 Cola de reproduccion
```

Mejor que la estructura actual:

```text
/artist/:name/:album
```

porque un album no deberia parecer subpagina generica del artista si vas a crecer la app.

URLs recomendadas:

```text
/?country=spain
/search/track?q=radiohead%20karma%20police
/search/artist?q=radiohead
/artist/Radiohead
/album/Radiohead/OK%20Computer
```

### Estado local

```text
Pinia
```

Usarlo solo para estado de cliente:

- playlist,
- cancion actual,
- volumen,
- mute,
- modo repeat/shuffle,
- preferencias de UI,
- pais seleccionado,
- ultima busqueda si quieres restaurarla.

No meter aqui directamente todas las respuestas de Last.fm/YouTube. Eso es estado remoto.

Stores recomendados:

```text
stores/
  playlist.store.ts
  player.store.ts
  preferences.store.ts
```

Modelo recomendado para playlist:

```ts
export interface PlaylistSong {
  id: string;
  artistName: string;
  trackName: string;
  imageUrl: string;
  youtubeVideoId: string;
  youtubeTitle?: string;
  youtubeThumbnailUrl?: string;
  source: 'lastfm' | 'manual';
}
```

Clave: usa ids estables, no indices como ahora. El estado actual con `playing: number` se rompe mas facil al borrar canciones.

### Estado remoto

```text
TanStack Vue Query
```

Usarlo para:

- busquedas Last.fm,
- ficha de artista,
- ficha de album,
- top tracks,
- top albums,
- top tags,
- YouTube search,
- reintentos,
- cache,
- invalidacion,
- loading/error/empty states.

Motivos:

- La app actual mezcla peticiones con estado global y componentes.
- TanStack Query esta pensado para datos remotos asincronos.
- Soporta cache, stale time, refetch, retries y cancelacion.

Ejemplo de query:

```ts
export function useArtistSearch(query: Ref<string>) {
  return useQuery({
    queryKey: ['lastfm', 'artist.search', query],
    enabled: computed(() => query.value.trim().length > 1),
    staleTime: 1000 * 60 * 60 * 24 * 5,
    queryFn: () => lastfm.searchArtists(query.value)
  });
}
```

### Validacion de API

```text
Zod
```

Motivos:

- Last.fm devuelve estructuras inconsistentes.
- YouTube puede devolver items sin `videoId` si no restringes `type=video`.
- El frontend no debe confiar en APIs externas.

Uso recomendado:

```ts
const YoutubeSearchItemSchema = z.object({
  id: z.object({
    videoId: z.string()
  }),
  snippet: z.object({
    title: z.string(),
    thumbnails: z.record(z.any()).optional()
  })
});
```

### Persistencia local

```text
IndexedDB + localStorage
```

Usar:

- `localStorage` para preferencias pequeñas:
  - volumen,
  - mute,
  - tema,
  - pais.
- IndexedDB para:
  - playlist,
  - cache persistente de resultados Last.fm,
  - cache de matches YouTube.

Libreria recomendada:

```text
idb-keyval
```

Motivo:

- Mas simple que escribir IndexedDB a mano.
- Suficiente para esta app.

TTL recomendado:

| Dato | TTL |
| --- | --- |
| Busquedas Last.fm | 5 dias |
| Ficha artista | 30 dias |
| Top tracks artista | 14 dias |
| Top albumes artista | 90-180 dias |
| Ficha album | 90-180 dias |
| Match YouTube de cancion | 30 dias |
| Playlist | Sin TTL |

### PWA

```text
vite-plugin-pwa
```

Usarlo, pero sin complicarse:

- manifest,
- iconos,
- cache de shell,
- aviso de nueva version,
- offline basico para abrir la app y ver playlist/cache local.

No intentes hacer offline total de musica. La reproduccion depende de YouTube.

### CSS y UI

Recomendacion:

```text
Tailwind CSS + CSS variables + componentes propios
```

Motivos:

- No necesitas un UI kit pesado.
- La app tiene identidad visual propia: player, cards, listas musicales.
- Tailwind acelera layout responsive sin bloquearte.
- CSS variables te permiten tema claro/oscuro y colores de marca.

Evitaria:

- Vuetify/PrimeVue/Quasar para esta app: son buenos, pero demasiado grandes/opinionados para un reproductor musical visual.
- Bootstrap: rapido, pero la app quedaria generica.

Componentes propios necesarios:

```text
components/
  app/AppHeader.vue
  app/AppShell.vue
  search/SearchBar.vue
  search/SearchTypeTabs.vue
  search/SearchResults.vue
  cards/ArtistCard.vue
  cards/AlbumCard.vue
  cards/TrackRow.vue
  player/PlayerBar.vue
  player/PlayerControls.vue
  player/ProgressBar.vue
  player/VolumeControl.vue
  playlist/PlaylistDrawer.vue
  feedback/Spinner.vue
  feedback/EmptyState.vue
  feedback/ErrorState.vue
```

### Iconos

```text
lucide-vue-next
```

Motivos:

- Evita el pipeline propio de Font Awesome actual.
- Tree-shaking correcto.
- API simple.
- Consistente para controles: play, pause, volume, search, list, plus, trash.

No reharia la fuente custom de iconos salvo que quieras aprender ese pipeline.

### Testing

```text
Vitest + Vue Test Utils + Playwright
```

Prioridad:

- Unit tests para adaptadores.
- Unit tests para stores.
- Tests para matching YouTube.
- E2E con mocks de Last.fm y YouTube.

No empezaria por snapshots visuales. Primero asegurar logica.

### Calidad

```text
ESLint + Prettier + TypeScript strict
```

Tambien:

- `lint-staged` opcional,
- `pnpm` como package manager,
- `node >= 22` si el hosting lo soporta.

Cloudflare Pages ya usa Node.js 22 en su build image segun su changelog reciente, pero no dependas de APIs raras de Node en una SPA.

## Arquitectura recomendada

```text
src/
  app/
    App.vue
    router.ts
    query-client.ts
    pwa.ts
  assets/
    styles/
    images/
  components/
    app/
    cards/
    feedback/
    player/
    search/
  features/
    album/
      AlbumDetailPage.vue
      album.queries.ts
      album.types.ts
    artist/
      ArtistDetailPage.vue
      artist.queries.ts
      artist.types.ts
    playlist/
      PlaylistPage.vue
      playlist.store.ts
    search/
      SearchPage.vue
      search.store.ts
  services/
    cache/
      cache.ts
      ttl.ts
    lastfm/
      lastfm.client.ts
      lastfm.adapters.ts
      lastfm.schemas.ts
      lastfm.types.ts
    youtube/
      youtube-search.client.ts
      youtube-player.ts
      youtube-match.ts
      youtube.types.ts
  shared/
    env.ts
    errors.ts
    format.ts
    ids.ts
```

Separacion clave:

- `services/lastfm`: sabe hablar con Last.fm.
- `services/youtube`: sabe buscar y reproducir.
- `features/*`: sabe montar pantallas.
- `stores/*`: sabe guardar estado local.
- `components/*`: UI reutilizable.

## APIs externas

### Last.fm

Last.fm sigue siendo buena opcion para metadatos musicales sin backend.

Usar para:

- busqueda de artistas,
- busqueda de albumes,
- busqueda de tracks,
- fichas de artista,
- fichas de album,
- top tracks,
- top albums,
- tags,
- artistas populares por pais.

No usar para:

- imagenes fiables de artista,
- reproduccion,
- autenticacion si no tienes backend.

Cliente recomendado:

```ts
const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';

export function buildLastfmUrl(method: string, params: Record<string, string | number>) {
  const url = new URL(LASTFM_BASE_URL);

  url.search = new URLSearchParams({
    method,
    api_key: import.meta.env.VITE_LASTFM_API_KEY,
    format: 'json',
    ...Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    )
  }).toString();

  return url;
}
```

Notas:

- `track.search` no requiere autenticacion, solo API key.
- No metas `sharedSecret` en frontend.
- Si algun dia quieres scrobbling, eso ya pide backend o un flujo OAuth que no deberia exponer el secreto.

### YouTube Search

Usar YouTube Data API solo para resolver:

```text
artist + track -> youtubeVideoId
```

Parametros recomendados:

```text
part=snippet
q={artist track official audio}
type=video
videoEmbeddable=true
maxResults=5
key={VITE_YOUTUBE_API_KEY}
```

Motivos:

- `type=video` evita canales/playlists.
- `videoEmbeddable=true` reduce resultados que luego no se puedan reproducir en iframe.
- `maxResults=5` permite elegir alternativa si el primer resultado falla.

Importante sobre cuota:

- YouTube cambio la forma documentada de cuota para `search.list`: ahora hay bucket especifico de 100 llamadas diarias para `search.list`, y cada llamada cuesta 1 en ese bucket.
- Eso hace que cachear matches YouTube sea obligatorio si no hay backend.

Estrategia de matching:

```text
1. Buscar "{artist} {track} official audio"
2. Si falla, buscar "{artist} {track} topic"
3. Si falla, buscar "{artist} {track}"
4. Guardar los 5 candidatos en cache.
5. Reproducir el mejor por scoring.
6. Si YouTube iframe devuelve error, probar siguiente candidato.
```

Scoring simple:

```text
+ artista aparece en titulo/canal
+ track aparece en titulo
+ titulo contiene "official audio"
+ canal contiene "topic" o "official"
- titulo contiene "cover"
- titulo contiene "karaoke"
- titulo contiene "remix" si el track no contiene remix
- titulo contiene "live" si el track no contiene live
```

### YouTube Player

Usar la API oficial:

```text
https://www.youtube.com/iframe_api
```

No usar una URL versionada de `www-widgetapi` como hace el proyecto actual.

Wrapper recomendado:

```ts
export class YoutubePlayerController {
  async mount(elementId: string) {}
  async load(videoId: string, autoplay = true) {}
  play() {}
  pause() {}
  seekTo(seconds: number) {}
  setVolume(value: number) {}
  mute() {}
  unMute() {}
  destroy() {}
}
```

Manejar eventos:

- `onReady`,
- `onStateChange`,
- `onError`.

Estados importantes:

- `0`: ended,
- `1`: playing,
- `2`: paused,
- `3`: buffering,
- `5`: video cued.

## Seguridad sin backend

Sin backend no puedes ocultar de verdad las API keys usadas por el navegador.

Esto es importante:

- En Vite, las variables `VITE_*` se exponen al bundle cliente.
- Por tanto, `VITE_LASTFM_API_KEY` y `VITE_YOUTUBE_API_KEY` seran visibles.
- La solucion no es fingir que son secretas, sino restringirlas.

Config recomendada:

```text
VITE_LASTFM_API_KEY=...
VITE_YOUTUBE_API_KEY=...
```

No incluir:

```text
VITE_LASTFM_SHARED_SECRET
```

Recomendaciones:

- YouTube: restringir key por HTTP referrer en Google Cloud.
- YouTube: limitar la key solo a YouTube Data API v3.
- Last.fm: usar solo API key publica.
- Last.fm: eliminar `sharedSecret` del cliente.
- Cachear YouTube search para no quemar cuota.
- Mostrar error claro cuando se agote cuota.

## Despliegue gratis

### Ganador: Cloudflare Pages

Recomendacion:

```text
Cloudflare Pages + GitHub integration
```

Configuracion:

```text
Framework preset: Vite
Build command: pnpm build
Build output directory: dist
Node version: 22
```

Variables:

```text
VITE_LASTFM_API_KEY=...
VITE_YOUTUBE_API_KEY=...
```

Ventajas:

- Static asset requests gratis e ilimitados si no invocas Functions.
- 500 builds/mes en Free.
- 1 build concurrente en Free.
- Timeout de build de 20 minutos.
- 20.000 archivos por sitio en Free.
- SPA fallback automatico si no hay `404.html`.
- Buen CDN global.
- Custom domain gratis.
- SSL automatico.
- No necesitas Functions.

Riesgos:

- Las variables `VITE_*` son publicas en el bundle.
- Si en el futuro agregas Pages Functions, ya entras en cuotas de Workers.
- Si creas `404.html` arriba del todo, Cloudflare deja de asumir fallback SPA automatico.

Archivo recomendado:

```text
public/_headers
```

Contenido:

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

No fuerces cache agresiva manual para `index.html`. Deja que Cloudflare Pages gestione sus defaults. Los assets con hash de Vite ya son seguros para cache larga.

### Segunda opcion: Vercel

Buena si quieres:

- previews muy comodos,
- dashboard excelente,
- analytics/speed insights simples,
- integracion muy pulida con GitHub.

Limites relevantes del plan Hobby:

- gratis para proyectos personales/no comerciales,
- 200 proyectos,
- 100 deploys/dia,
- 45 minutos maximos de build por deployment,
- 100 MB de static file uploads,
- 100 GB de fast data transfer incluidos,
- 1 build concurrente,
- 6000 minutos de build execution.

Por que no la pongo primera:

- Para una SPA estatica pura, Cloudflare Pages es mas generoso en static assets.
- Vercel brilla mas con Next/SSR/edge, que aqui no quieres usar.
- Hobby tiene restriccion de uso personal/no comercial.

Config:

```text
Framework preset: Vite
Build command: pnpm build
Output directory: dist
```

### Tercera opcion: GitHub Pages

Buena si:

- quieres cero cuentas nuevas,
- el repo vive en GitHub,
- aceptas una solucion menos flexible.

Limites:

- sitio publicado maximo 1 GB,
- timeout de deploy 10 minutos,
- soft bandwidth limit 100 GB/mes,
- soft limit 10 builds/hora si no usas workflow propio.

Problema principal:

- Las rutas SPA con history mode son mas incomodas.
- Si refrescas `/artist/Radiohead`, GitHub Pages no tiene fallback real a `index.html`.

Soluciones:

- usar hash routing:

```text
/#/artist/Radiohead
```

- o hack de `404.html` que carga la SPA.

Yo no la elegiria para esta app salvo que quieras mantenerlo todo dentro de GitHub Pages por simplicidad.

### Cuarta opcion: Firebase Hosting

Buena si:

- ya estas en Google Cloud/Firebase,
- quieres alojar estatico y quizas en el futuro sumar Auth/Firestore.

Dato relevante:

- Firebase Hosting ofrece almacenamiento de hosting sin coste hasta 10 GB.

Por que no la pongo primera:

- Para solo frontend estatico, Cloudflare Pages es mas directo.
- Si empiezas a meter Firebase Auth/Firestore ya te acercas a backend/BaaS, y dijiste que no quieres back.

### No recomendada como primera opcion: Netlify

Netlify sigue siendo buena plataforma, pero no la elegiria para este caso gratis.

Motivos:

- El plan Free actual usa creditos.
- 300 creditos/mes compartidos entre uso.
- 1 build concurrente.
- Produccion, bandwidth, compute y requests consumen creditos.
- Para una SPA publica que podria recibir trafico, Cloudflare Pages es mas claro.

## Comparativa rapida

| Plataforma | Veredicto | Motivo |
| --- | --- | --- |
| Cloudflare Pages | Mejor | Static assets gratis/ilimitados, CDN fuerte, SPA fallback, 500 builds/mes |
| Vercel | Muy buena | DX excelente, pero mas orientado a apps con compute/SSR |
| GitHub Pages | Correcta | Gratis y simple, pero peor para SPA history mode |
| Firebase Hosting | Correcta | Buena si ya usas Firebase, no necesaria aqui |
| Netlify | No primera opcion | Plan gratis actual basado en creditos |

## Configuracion exacta recomendada

### `package.json`

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint .",
    "format": "prettier . --write"
  }
}
```

### Dependencias

```bash
pnpm add vue vue-router pinia @tanstack/vue-query zod idb-keyval lucide-vue-next
pnpm add -D vite typescript vue-tsc vitest @vue/test-utils playwright eslint prettier tailwindcss vite-plugin-pwa
```

### `.env.example`

```text
VITE_LASTFM_API_KEY=
VITE_YOUTUBE_API_KEY=
```

No incluir:

```text
VITE_LASTFM_SHARED_SECRET=
```

### `src/shared/env.ts`

```ts
const required = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
};

export const env = {
  lastfmApiKey: required('VITE_LASTFM_API_KEY', import.meta.env.VITE_LASTFM_API_KEY),
  youtubeApiKey: required('VITE_YOUTUBE_API_KEY', import.meta.env.VITE_YOUTUBE_API_KEY)
};
```

### `vite.config.ts`

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Bruga Music',
        short_name: 'Bruga Music',
        display: 'standalone',
        theme_color: '#e95420',
        background_color: '#191a28',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
```

### Router

```ts
import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: () => import('@/features/search/HomePage.vue') },
    { path: '/search/:type', component: () => import('@/features/search/SearchPage.vue') },
    { path: '/artist/:artistName', component: () => import('@/features/artist/ArtistDetailPage.vue') },
    { path: '/album/:artistName/:albumName', component: () => import('@/features/album/AlbumDetailPage.vue') },
    { path: '/playlist', component: () => import('@/features/playlist/PlaylistPage.vue') }
  ],
  scrollBehavior: () => ({ top: 0 })
});
```

## Producto recomendado

### MVP bueno

Primera version:

- Home con top artists por pais.
- Busqueda por track/album/artist.
- Ficha de artista.
- Ficha de album.
- Agregar canciones.
- Resolver YouTube con cache.
- Reproducir con iframe oficial.
- Playlist persistida.
- Player responsive.
- Errores claros.
- Deploy Cloudflare Pages.

### Segunda iteracion

- Selector de video alternativo.
- Shuffle/repeat.
- Play album.
- Add album to playlist.
- Media Session API.
- Modo oscuro/claro.
- Mas paises.
- Mejor ranking de YouTube.
- Import/export de playlist como JSON.

### Tercera iteracion

Solo si aceptas BaaS o backend:

- Login.
- Playlists en nube.
- Scrobbling Last.fm.
- Favoritos.
- Historial multi-dispositivo.

Sin backend, todo eso queda limitado al navegador local.

## Decisiones importantes

### 1. SPA estatica, no SSR

Esta app no necesita SSR porque:

- el contenido depende de APIs externas,
- no hay SEO fuerte por ficha si no tienes backend/pre-render,
- el valor esta en interaccion musical,
- Cloudflare Pages sirve SPA muy bien,
- evitas coste y complejidad.

### 2. Pinia no debe ser tu cache de APIs

Pinia para estado local.

TanStack Query para estado remoto.

Esto evita stores enormes y hace que loading/error/retry/cache sean consistentes.

### 3. YouTube search debe cachearse agresivamente

Sin backend, cada usuario consume la key directamente.

Por tanto:

- cache local por `artist + track`,
- evitar repetir busquedas,
- guardar candidatos,
- permitir reutilizar `youtubeVideoId`,
- fallback si un video falla.

### 4. No metas secretos reales

API key publica en frontend: aceptable si esta restringida.

Shared secret en frontend: no aceptable.

### 5. Mejorar imagenes

Problema actual:

- Last.fm no es fiable para imagenes de artista.
- El hack de Bing puede devolver resultados incorrectos.

Opciones sin backend:

- Usar imagen de album/track cuando exista.
- Usar YouTube thumbnail para canciones agregadas.
- Para artistas, usar placeholder bonito si no hay imagen fiable.
- No depender de scraping.

## Plan de implementacion

### Semana 1

- Crear proyecto Vite Vue TS.
- Configurar router, Pinia, TanStack Query.
- Crear layout base.
- Crear cliente Last.fm con `URLSearchParams`.
- Crear adaptadores y modelos.
- Tests de adaptadores.

### Semana 2

- Home.
- Search.
- Results.
- Artist detail.
- Album detail.
- Estados loading/error/empty.

### Semana 3

- Cliente YouTube search.
- Matching y cache.
- Wrapper oficial IFrame API.
- Player.
- Playlist persistida.

### Semana 4

- PWA.
- Cloudflare Pages.
- Responsive.
- Accesibilidad.
- Playwright E2E.
- Pulido visual.

## Checklist de despliegue Cloudflare Pages

1. Subir repo a GitHub.
2. Crear proyecto en Cloudflare Pages.
3. Conectar repo.
4. Framework preset: `Vite`.
5. Build command: `pnpm build`.
6. Output directory: `dist`.
7. Node version: `22`.
8. Agregar env vars:

```text
VITE_LASTFM_API_KEY
VITE_YOUTUBE_API_KEY
```

9. No crear `404.html` en raiz si quieres fallback SPA automatico.
10. Configurar dominio custom si tienes.
11. Restringir YouTube key al dominio final y al subdominio preview si lo usas.
12. Probar rutas directas:

```text
/artist/Radiohead
/album/Radiohead/OK%20Computer
/playlist
```

13. Probar cuota/errores de YouTube.
14. Probar en movil.

## Fuentes consultadas

- Vite docs: https://vite.dev/guide/
- Vite env vars: https://vite.dev/guide/env-and-mode
- Vue 3 migration recommendations: https://v3-migration.vuejs.org/recommendations.html
- Pinia docs: https://pinia.vuejs.org/
- TanStack Vue Query docs: https://tanstack.com/query/latest/docs/framework/vue
- vite-plugin-pwa: https://github.com/vite-pwa/vite-plugin-pwa
- Last.fm API: https://www.last.fm/api
- Last.fm `track.search`: https://www.last.fm/api/show/track.search
- YouTube Data API `search.list`: https://developers.google.com/youtube/v3/docs/search/list
- YouTube quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Pages pricing for Functions/static assets: https://developers.cloudflare.com/pages/functions/pricing/
- Cloudflare Pages serving/SPAs: https://developers.cloudflare.com/pages/configuration/serving-pages/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel limits: https://vercel.com/docs/limits
- Netlify pricing: https://www.netlify.com/pricing/
- Firebase Hosting quotas/pricing: https://firebase.google.com/docs/hosting/usage-quotas-pricing

## Veredicto final

Rehazla como SPA moderna, no como app full-stack:

```text
Vue 3 + Vite + TypeScript + Pinia + TanStack Vue Query + Cloudflare Pages
```

El mayor riesgo no es el framework. El mayor riesgo es YouTube:

- cuota,
- matching incorrecto,
- videos no embeddable,
- errores del iframe.

Por eso el foco tecnico debe estar en:

- cachear busquedas YouTube,
- guardar candidatos,
- usar `type=video` y `videoEmbeddable=true`,
- manejar `onError`,
- permitir elegir alternativa,
- persistir playlist.

Con eso, puedes tener una version nueva bastante solida sin backend y con despliegue gratis real.
