# Documentacion detallada para rehacer Bruga Music

Este documento describe el proyecto actual `bruga-music` con el objetivo de poder rehacerlo desde cero entendiendo que hace, como funciona por dentro, que decisiones tecnicas toma y que se podria mejorar.

La descripcion esta basada en el codigo existente del repositorio, no en una idea idealizada de la aplicacion.

## Resumen corto

Bruga Music es una aplicacion web de musica hecha con Vue 2, Vuex y Vue Router.

La app permite:

- Ver artistas populares de Last.fm por pais.
- Buscar canciones, albumes o artistas en Last.fm.
- Abrir una ficha detallada de artista.
- Abrir una ficha detallada de album.
- Agregar canciones a una cola de reproduccion.
- Buscar automaticamente esas canciones en YouTube.
- Reproducir el primer resultado de YouTube con un reproductor oculto.
- Controlar play, pause, anterior, siguiente, progreso, volumen y mute.
- Consultar y gestionar la playlist temporal.
- Funcionar como PWA en produccion, con manifest y service worker generado por Workbox.

La aplicacion no aloja musica propia. Usa Last.fm como fuente de metadatos y YouTube como fuente de reproduccion.

## Que problema resuelve

La app funciona como un explorador musical ligero:

1. El usuario descubre artistas populares por pais.
2. El usuario busca musica por artista, album o cancion.
3. El usuario entra en fichas con informacion, tags, estadisticas, albumes, canciones populares y artistas similares.
4. El usuario agrega canciones a una playlist.
5. La app encuentra esas canciones en YouTube y las reproduce.

En terminos de producto, es una mezcla entre:

- buscador musical,
- mini wiki musical,
- reproductor basado en YouTube,
- playlist temporal.

## Lo que hace exactamente

### Pantalla principal

Ruta:

```text
/
```

Componente:

```text
src/routes/Main.vue
```

Al entrar, la app carga por defecto los artistas populares de Last.fm para `spain`.

El usuario ve:

- Un formulario de busqueda.
- Un selector de tipo de busqueda:
  - tracks,
  - albums,
  - artists.
- Un boton `Search`.
- Una zona de resultados.
- Si no hay busqueda manual, el titulo indica que se estan mostrando artistas populares por pais.
- Un selector de pais con:
  - Argentina,
  - Colombia,
  - Espana.

Cuando el usuario busca:

- Si el tipo es `track`, se llama a `track.search` de Last.fm.
- Si el tipo es `album`, se llama a `album.search` de Last.fm.
- Si el tipo es `artist`, se llama a `artist.search` de Last.fm.

Cuando el usuario borra la busqueda:

- Se vuelve a cargar el listado de artistas populares del pais activo.

### Resultados de artista

Componente:

```text
src/components/Artist.vue
```

Cada artista se muestra como una tarjeta con:

- imagen,
- nombre,
- enlace interno a la ficha del artista.

La navegacion usa Vue Router:

```js
{ name: 'Artist', params: { name: artist.name } }
```

Esto lleva a:

```text
/artist/:name
```

### Resultados de album

Componente:

```text
src/components/Album.vue
```

Cada album se muestra como una tarjeta con:

- imagen,
- nombre del artista,
- nombre del album,
- enlace interno a la ficha del album.

La navegacion usa Vue Router:

```js
{ name: 'Album', params: { name: album.artist, album: album.name } }
```

Esto lleva a:

```text
/artist/:name/:album
```

### Resultados de cancion

Componente:

```text
src/components/Song.vue
```

Cada cancion se muestra como una fila con:

- imagen,
- artista,
- nombre de cancion,
- icono contextual.

El icono cambia segun el estado:

- Si no hay ninguna cancion en la playlist, muestra play.
- Si ya hay canciones en la playlist y esta cancion no esta agregada, muestra plus.
- Si la cancion ya esta en la playlist, muestra check.
- Si la cancion es la actual, muestra play.

Al hacer click:

- Si la cancion ya esta sonando, no hace nada.
- Si la cancion ya esta en la playlist, cambia la cancion activa a esa entrada.
- Si la cancion no esta en la playlist, despacha `addOrPlaySong` en Vuex.

`addOrPlaySong`:

1. Comprueba si ya existe una cancion con el mismo artista y nombre.
2. Si no existe, construye una query de busqueda.
3. Llama a YouTube Data API.
4. Toma el primer resultado.
5. Guarda en Vuex:
   - artista,
   - track,
   - imagen original de Last.fm,
   - `youtubeId`,
   - thumbnail de YouTube.

Importante: si la playlist ya tenia canciones, agregar una cancion nueva no cambia automaticamente la cancion activa. Solo empieza a sonar automaticamente cuando es la primera cancion agregada, porque el indice activo inicial es `0`.

### Ficha de artista

Ruta:

```text
/artist/:name
```

Componente:

```text
src/routes/ArtistDetail.vue
```

La ficha de artista carga:

- Datos principales con `artist.getinfo`.
- Nombre.
- Imagen.
- Listeners.
- Scrobblings.
- Tags.
- Biografia.
- Canciones populares.
- Albumes.
- Artistas similares.
- Link externo `More information` hacia Last.fm.

Los datos principales se piden en `ArtistDetail.vue`.

Las secciones secundarias se cargan en componentes hijos:

- `src/components/artist/Biography.vue`
- `src/components/artist/TopTracks.vue`
- `src/components/artist/Albums.vue`
- `src/components/artist/Similar.vue`
- `src/components/artist/TopTags.vue`

`TopTracks`, `Albums` y `TopTags` usan `vue-async-computed`, asi que cargan sus datos de forma independiente cuando el componente se monta o se activa.

### Ficha de album

Ruta:

```text
/artist/:name/:album
```

Componente:

```text
src/routes/AlbumDetail.vue
```

La ficha de album carga:

- Datos principales con `album.getinfo`.
- Nombre.
- Artista.
- Imagen.
- Listeners.
- Scrobblings.
- Tags.
- Wiki/resumen.
- Tracks del album.
- Link externo `More information` hacia Last.fm.

Los tracks del album se renderizan con el mismo componente de cancion general:

```text
src/components/Song.vue
```

Por eso las canciones de un album tambien se pueden agregar a la playlist y reproducir con YouTube.

### Playlist

Ruta:

```text
/playlist
```

Componente:

```text
src/routes/Playlist.vue
```

La playlist muestra las canciones agregadas a Vuex.

Cada entrada permite:

- seleccionar esa cancion como actual,
- eliminarla de la playlist.

Hay una proteccion de ruta:

```text
src/routes/index.js
```

La ruta `/playlist` solo se abre si `store.getters.hasSong` es verdadero. Si no hay canciones:

- Si el usuario venia de otra ruta, se cancela la navegacion.
- Si entro directamente por URL sin ruta anterior, se redirige a `/`.

La playlist no se guarda en `localStorage`, IndexedDB ni servidor. Se pierde al recargar la pagina.

### Footer y reproductor

Componentes principales:

```text
src/components/static/Footer.vue
src/components/player/Player.vue
```

El footer contiene:

- el reproductor visible,
- un `div` oculto con id `ytPlayer`.

El `div#ytPlayer` es donde se monta el iframe de YouTube.

El reproductor visible esta oculto hasta que existe al menos una cancion en Vuex. Cuando aparece la primera cancion:

1. `Player.vue` emite `show-player`.
2. `Footer.vue` ajusta `--footer-height`.
3. El footer anima su altura.
4. El reproductor aparece desde abajo.

El reproductor muestra:

- imagen de la cancion,
- artista,
- nombre de track,
- boton anterior,
- boton play/pause,
- boton siguiente,
- barra de progreso,
- control de volumen,
- mute/unmute,
- icono animado de sonido,
- tiempo actual y duracion,
- acceso a playlist con indicador `actual / total`.

Cuando cambia la cancion activa en Vuex:

1. `Player.vue` detecta el cambio con un watcher sobre `playing`.
2. Si cambia el `youtubeId`, llama a `this.$youtube.player.load(youtubeId, true)`.
3. El wrapper de YouTube carga el video con autoplay.
4. Cuando YouTube confirma estado `Playing`, la promesa se resuelve.
5. La app guarda la duracion.
6. La app marca `isPlaying = true`.
7. Cambia `document.title` a:

```text
track - artist | Bruga Music
```

Cuando termina una cancion:

1. El wrapper de YouTube detecta estado `Ended`.
2. Ejecuta el callback configurado con `setEndSongEvent`.
3. `Player.vue` marca `isPlaying = false`.
4. Despacha `playNextSong`.
5. Si hay siguiente cancion, Vuex cambia el indice activo y se carga el siguiente video.
6. Si no hay siguiente, se queda parado al final de la playlist.

## Lo que no hace

La app actual no incluye:

- Login de usuarios.
- Persistencia de playlist entre sesiones.
- Sincronizacion con cuenta de Last.fm.
- Scrobbling.
- Likes reales.
- Recomendaciones propias.
- Backend propio.
- Proxy de APIs.
- Tests automatizados.
- Gestion robusta de errores.
- Internacionalizacion real.
- Control avanzado de permisos o privacidad.
- Busqueda incremental con debounce.
- Cancelacion de peticiones cuando una busqueda nueva reemplaza a una antigua.
- Seleccion manual del video de YouTube si el primer resultado no es correcto.

## Arquitectura actual

### Stack

Dependencias principales:

```text
Vue 2.7
Vue Router 3
Vuex 3
vue-async-computed
Webpack 5
LESS
Last.fm API
YouTube Data API
YouTube iframe/widget API
IndexedDB
Workbox
```

La app es una SPA. No hay backend.

### Estructura de carpetas

```text
src/
  api/
    lastfm/
      adapt.js
      config.js
      services.js
      vue-plugin.js
    youtube/
      api.js
      player.js
      vue-plugin.js
      widget.js
    utils/
      fetch.js
      fetch-cache.js
  assets/
    bruga-font.js
    bruga-font.css.hbs
    logo.png
    styles/
    svgs/
  components/
    album/
    artist/
    common/
    player/
    playlist/
    static/
  partials/
    loading.html
  routes/
    AlbumDetail.vue
    ArtistDetail.vue
    Main.vue
    Playlist.vue
    index.js
  store/
    index.js
    initialize.js
  utils/
  App.vue
  index.html
  index.js
```

### Entrada de la aplicacion

Archivo:

```text
src/index.js
```

El arranque ocurre en `window.load`.

Flujo:

1. Espera al evento `load` del navegador.
2. Si existe `navigator.serviceWorker`, registra:

```text
${publicPath}js/service-worker.js
```

3. Ejecuta `loadApp()`.
4. Instala plugins globales:
   - Vue Router,
   - bus global,
   - filtros,
   - `vue-async-computed`.
5. Crea el router en modo `history`.
6. Crea la instancia Vue principal con:
   - `App`,
   - `router`,
   - `store`.

El valor `PUBLIC_PATH` se inyecta desde Webpack con `DefinePlugin`. En produccion normal vale `/`. En GitHub Pages, el script `build:gh-pages` lo configura como `/bruga-music/`.

### Aplicacion raiz

Archivo:

```text
src/App.vue
```

La raiz contiene:

- `Header`,
- `main` con `router-view`,
- `Footer`.

El `router-view` esta dentro de:

```html
<keep-alive :max="5">
  <router-view />
</keep-alive>
```

Esto cachea hasta 5 componentes de ruta.

Tambien aplica transiciones segun la ruta:

- `slide-left`
- `slide-right`
- `zoom`

La direccion de `slide` se decide comparando la profundidad de la URL:

- si se entra a una ruta mas profunda, usa `slide-left`,
- si se vuelve a una ruta menos profunda, usa `slide-right`.

En `mounted`, la app aplica:

- ajuste de viewport movil,
- fix de header en iOS cuando se cierra el teclado,
- fallback para ocultar el loader inicial.

### Rutas

Archivo:

```text
src/routes/index.js
```

Rutas:

```js
[
  { path: '/', name: 'Main' },
  { path: '/playlist', name: 'Playlist' },
  { path: '/artist/:name', name: 'Artist' },
  { path: '/artist/:name/:album', name: 'Album' }
]
```

Notas:

- Todas usan Vue Router en modo `history`.
- La ruta `/playlist` tiene guard.
- Las rutas de detalle usan transicion `slide`.
- La playlist usa transicion `zoom`.
- `scrollBehavior` siempre devuelve `{ x: 0, y: 0 }`.

### Estado global

Archivo:

```text
src/store/index.js
```

Estado:

```js
{
  playing: 0,
  songs: []
}
```

`playing` es un indice numerico dentro de `songs`.

Cada cancion en `songs` tiene esta forma aproximada:

```js
{
  artist: 'Artist name',
  track: 'Track name',
  image: 'Last.fm or Bing image URL',
  youtubeId: 'YouTube video id',
  thumbnail: 'YouTube thumbnail URL'
}
```

Getters principales:

- `hasSong`: hay canciones en la playlist.
- `hasPrevSong`: `playing > 0`.
- `hasNextSong`: existe una cancion despues del indice actual.
- `searchSongByNameAndArtist`: busca por `track` y `artist`.
- `searchSongIndexByNameAndArtist`: devuelve indice por `track` y `artist`.
- `searchSongByYoutubeId`: busca por `youtubeId`.
- `searchSongIndexByYoutubeId`: devuelve indice por `youtubeId`.
- `playlist`: devuelve `songs`.
- `playlistStatus`: devuelve texto tipo `1 / 3`.
- `playing`: devuelve la cancion actual o `{}`.
- `imagePlaying`: devuelve `image`, `thumbnail` o string vacio.

Mutations:

- `addSong`
- `removeSong`
- `prevSong`
- `nextSong`
- `playSong`

Actions:

- `addOrPlaySong`
- `changePlayingSong`
- `deleteSong`
- `playPrevSong`
- `playNextSong`

### Inicializacion del store

Archivo:

```text
src/store/initialize.js
```

Instala Vuex y los plugins API:

- `YouTube`
- `LastFM`

Despues copia las APIs al prototipo de Vuex Store:

```js
Vuex.Store.prototype.$youtube = Vue.prototype.$youtube;
Vuex.Store.prototype.$lastfm = Vue.prototype.$lastfm;
```

Esto permite usar:

```js
this.$youtube.search(...)
```

dentro de actions de Vuex.

## APIs externas

### Last.fm

Config:

```text
src/api/lastfm/config.js
```

Contiene:

- `appName`,
- `apiKey`,
- `sharedSecret`,
- usuario registrado,
- URL base.

URL base:

```text
https://ws.audioscrobbler.com/2.0/
```

Servicios:

```text
src/api/lastfm/services.js
```

Metodos usados:

- `geo.gettopartists`
- `artist.getinfo`
- `artist.gettoptags`
- `artist.gettopalbums`
- `artist.gettoptracks`
- `album.getinfo`
- `track.getinfo`
- `track.search`
- `album.search`
- `artist.search`

La URL se construye con:

```js
buildApiUrl(method, params)
```

que internamente concatena:

```text
url?method=...&param=value&api_key=...&format=json
```

Los detalles de artista, album y track pasan por `sanitize`, que reemplaza:

- `+` por `%2B`,
- espacio por `%20`.

Las busquedas (`track.search`, `album.search`, `artist.search`) pasan el texto de busqueda directamente, sin `URLSearchParams`.

### Adaptadores Last.fm

Archivo:

```text
src/api/lastfm/adapt.js
```

Este archivo transforma las respuestas crudas de Last.fm al formato que usa la UI.

#### Artistas

Lista de artistas:

```js
{
  name,
  image,
  mbid
}
```

Detalle de artista:

```js
{
  name,
  stats,
  image,
  moreLink,
  biography,
  similar,
  tags
}
```

#### Albumes

Lista de albumes:

```js
{
  name,
  artist,
  image
}
```

Detalle de album:

```js
{
  mbid,
  name,
  artist,
  image,
  stats,
  moreLink,
  tags,
  tracks,
  wiki
}
```

#### Tracks

Lista de tracks:

```js
{
  mbid,
  artist,
  name,
  image
}
```

#### Tags

Tags:

```js
{
  name
}
```

### Workaround de imagenes

Last.fm restringio el uso de imagenes de artista en su API. El proyecto tiene esta constante:

```js
const LASTFM_API_RESTRICTS_IMAGES = true;
```

Cuando esta activa:

- Las imagenes de artistas no se sacan de Last.fm.
- Se genera una URL de thumbnail de Bing con el nombre del artista y la palabra `spotify`.

Formato aproximado:

```text
https://tse2.mm.bing.net/th?q={name}+spotify&w={size}&h={size}&...
```

Para tracks, si la restriccion esta activa, se busca imagen por artista.

Para albumes, el adaptador sigue usando el array de imagenes de Last.fm.

### YouTube Data API

Archivo:

```text
src/api/youtube/api.js
```

Endpoint:

```text
https://www.googleapis.com/youtube/v3/search
```

Parametros:

```text
part=snippet
key=...
q={query}
maxResults=5
```

La app toma `json.items` y, al agregar una cancion, usa siempre:

```js
results[0].id.videoId
results[0].snippet.thumbnails.high.url
```

No hay validacion si `results` viene vacio.

### YouTube Player API

Archivos:

```text
src/api/youtube/player.js
src/api/youtube/widget.js
```

`player.js` define una clase `YouTubePlayer` que envuelve el player de YouTube.

API publica:

- `load(videoId, autoplay)`
- `play()`
- `pause()`
- `stop()`
- `goTo(time)`
- `setVolume(volume)`
- `mute()`
- `unmute()`
- `muted()`
- `volume()`
- `duration()`
- `setEndSongEvent(event)`
- `setCurrentTimeEvent(event)`
- `setOnReadyEvent(event)`

Estados usados:

```js
const YouTubeState = {
  None: -2,
  Unstarted: -1,
  Ended: 0,
  Playing: 1,
  Paused: 2,
  Buffering: 3,
  Cued: 5
};
```

Cuando se llama a `load(videoId, true)`:

1. Se asegura de cargar la API.
2. Guarda una promesa pendiente.
3. Define que la promesa debe resolverse cuando YouTube emita `Playing`.
4. Llama a `loadVideoById(videoId, 0, 'large')`.

Cuando se llama a `load(videoId, false)`:

1. Define que la promesa debe resolverse cuando YouTube emita `Cued`.
2. Llama a `cueVideoById(videoId, 0, 'large')`.

Mientras YouTube esta en estado `Playing`, se abre un intervalo cada 200 ms para emitir el tiempo actual.

Cuando cambia a otro estado:

- se detiene el intervalo,
- se emite una actualizacion final de tiempo.

Cuando llega estado `Ended`:

- se ejecuta el evento de fin de cancion.

### Carga del widget de YouTube

Archivo:

```text
src/api/youtube/widget.js
```

Este archivo no carga directamente `https://www.youtube.com/iframe_api`. En su lugar contiene una reescritura parcial del loader de Google y carga:

```text
https://www.youtube.com/s/player/be9c9f3b/www-widgetapi.vflset/www-widgetapi.js
```

Despues define:

```js
window.onYouTubeIframeAPIReady = function () {
  const player = new window.YT.Player('ytPlayer', ...)
}
```

El player se monta sobre:

```html
<div id="ytPlayer" />
```

que esta en el footer y es invisible:

```css
#ytPlayer {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
```

## Cache local

La app tiene una capa propia de cache sobre `fetch`.

Archivos:

```text
src/api/utils/fetch.js
src/api/utils/fetch-cache.js
```

`fetch.js`:

- importa `unfetch/polyfill`,
- usa `Yaku` como fallback de Promise,
- exporta `fetch`.

`fetch-cache.js`:

- usa IndexedDB si esta disponible,
- crea una base de datos llamada `localFetchCache`,
- crea un object store llamado `requests`,
- usa la URL completa como key,
- guarda:

```js
{
  url,
  response,
  time
}
```

La funcion principal es:

```js
fetchCache(url, options)
```

Si `options.localCache` no existe, usa fetch normal.

Si hay `localCache`:

1. Abre IndexedDB.
2. Busca la URL.
3. Si existe y no expiro, devuelve un objeto que imita una response:

```js
{ json: () => cachedJson }
```

4. Si no existe o expiro, hace fetch real.
5. Si la respuesta no es `ok`, lanza error.
6. Guarda el JSON en IndexedDB.
7. Devuelve el JSON envuelto en `{ json: () => json }`.

### TTLs actuales

Los TTLs se definen en:

```text
src/utils/unit-times-in-ms.js
```

Uso en Last.fm:

| Dato | Metodo | TTL local |
| --- | --- | --- |
| Top artists por pais | `geo.gettopartists` | 2 semanas |
| Info de artista | `artist.getinfo` | 1 mes |
| Top tags de artista | `artist.gettoptags` | 6 meses |
| Top albumes de artista | `artist.gettopalbums` | 6 meses |
| Top tracks de artista | `artist.gettoptracks` | 2 semanas |
| Info de album | `album.getinfo` | 6 meses |
| Info de track | `track.getinfo` | 1 ano |
| Busquedas | `track.search`, `album.search`, `artist.search` | 5 dias |

Uso en YouTube:

| Dato | Metodo | TTL local |
| --- | --- | --- |
| Busqueda de video | YouTube search | 2 semanas |

## Loader inicial

Archivo:

```text
src/partials/loading.html
```

El HTML inicial contiene:

- un fondo SVG con gradiente estilo Ubuntu,
- un spinner de bolas,
- el titulo `Bruga Music`,
- un script global `window.stopLoadingWithDelay`.

Antes de montar Vue:

```html
<div id="background" class="visible">
  <include src="./partials/loading.html"/>
</div>
<div id="app"></div>
```

Webpack procesa el `<include>` con un preprocessor de `html-loader`.

Cuando `window.stopLoadingWithDelay()` se ejecuta:

1. Espera un delay.
2. Oculta las bolas al terminar su iteracion de animacion.
3. Oculta el titulo.
4. Empuja el fondo hacia atras.
5. Muestra `#app`.
6. Marca `:root` como `loaded`.
7. Elimina el spinner del DOM.
8. Reemplaza `window.stopLoadingWithDelay` por una funcion vacia.

Lugares que llaman a `stopLoadingWithDelay`:

- `Main.vue`, cuando termina la carga inicial de artistas.
- `ArtistDetail.vue`, cuando termina la carga principal del artista.
- `AlbumDetail.vue`, cuando termina la carga principal del album.
- `App.vue`, como fallback tras montar la app.

## Estilos y layout

La app usa LESS.

Entrada global:

```text
src/assets/styles/main.less
```

Este archivo importa:

- Google Fonts,
- colores,
- mixins,
- estilos de detalle,
- estilos del loading,
- estilos de layout.

Paleta:

```text
src/assets/styles/colors.less
```

Colores principales:

- naranja principal `#e95420`,
- fondo header `#191a28`,
- fondo cards `#2a2a2e`,
- rojo `#c83430`,
- azul de musica `#1565c0`,
- blanco `#fff`,
- gris `#495057`.

La UI usa:

- tarjetas oscuras,
- header oscuro fijo en la estructura flex,
- fondo SVG inicial,
- footer con reproductor blanco,
- imagenes redondas en el player,
- imagenes cuadradas en artistas y albumes,
- listas flexibles.

### Layout movil

Hay varias utilidades para evitar problemas de `100vh` en movil:

```text
src/utils/safe-viewport-area.js
src/utils/detect-mobile-devices.js
src/utils/ios-home-button-detect.js
src/utils/ios-header-fix.js
```

La app ajusta la variable CSS:

```css
--viewport-height
```

para compensar barras de navegador en Android e iOS.

Tambien intenta detectar iPhones con boton fisico para ajustar el espacio inferior.

### Scrolling

El root de la app:

```html
<div id="app" class="full-height-viewport-mobile max-height-viewport-mobile scrolling-parent">
```

El `main`:

```html
<main class="main loading-scale scrolling-element">
```

La intencion es que:

- `Header` y `Footer` vivan fuera del elemento con scroll.
- El scroll real ocurra dentro del `main`.
- Esto ayuda a controlar el viewport movil, aunque tambien exige hacks para iOS.

## Iconos

El proyecto no importa Font Awesome como paquete de runtime. Tiene SVGs descargados en:

```text
src/assets/svgs/font/
```

Y genera una fuente propia con:

```text
src/assets/bruga-font.js
src/assets/bruga-font.css.hbs
```

Webpack tiene una regla especial para archivos `-font.js` usando:

```text
webfonts-loader
```

La fuente genera clases:

```text
.bm-icon
.bm-icon-play-solid
.bm-icon-pause-solid
...
```

Scripts relacionados:

```text
scripts/utils-icons/download-icon.js
scripts/utils-icons/download-included-icons.js
scripts/utils-icons/download-fa-icon.js
scripts/utils-icons/download-icon-utils.js
scripts/utils-icons/get-all-icons-urls.js
scripts/utils-icons/included-icons.json
```

Funcionamiento:

1. Se guarda una lista de URLs de Font Awesome en `included-icons.json`.
2. Un script usa Puppeteer para abrir la pagina de cada icono.
3. Extrae el SVG del DOM.
4. Optimiza el SVG con SVGO.
5. Lo guarda en `src/assets/svgs/font/`.
6. Webpack genera la fuente con esos SVGs.

Comandos:

```bash
npm run icons:add
npm run icons:update-included
```

## Build y scripts

Archivo:

```text
package.json
```

Scripts importantes:

```bash
npm run start
npm run start:local
npm run start:static
npm run build
npm run build:gh-pages
npm run build:analyzer
npm run lint
```

### Desarrollo

```bash
npm run start
```

Ejecuta:

```bash
cross-env NODE_ENV=development webpack serve --hot
```

Webpack Dev Server:

- puerto `8080`,
- hot reload,
- abre navegador,
- host `local-ip` salvo en `start:local`.

### Desarrollo en red local

```bash
npm run start:local
```

Define `LOCAL=true`, y Webpack usa:

```js
host: '0.0.0.0'
```

### Build normal

```bash
npm run build
```

Define `NODE_ENV=production` y ejecuta Webpack.

En produccion:

- se desactiva `devtool`,
- `mode` pasa a `production`,
- se agrega preset `minify`,
- se genera service worker con Workbox.

### Build GitHub Pages

```bash
npm run build:gh-pages
```

Define:

```text
PUBLIC_PATH=bruga-music
```

Eso hace que el `publicPath` sea:

```text
/bruga-music/
```

### Analyzer

```bash
npm run build:analyzer
```

Activa `webpack-bundle-analyzer`.

### PWA

Webpack genera:

- manifest PWA con `webpack-pwa-manifest`,
- service worker con `workbox-webpack-plugin`.

El manifest usa:

- nombre `Bruga Music`,
- orientacion portrait,
- display standalone,
- iconos derivados de `src/assets/logo.png`,
- colores de tema.

## Flujo completo de una cancion

Ejemplo: usuario busca una cancion y la reproduce.

1. Usuario escribe en el input.
2. Usuario deja tipo `Tracks`.
3. Usuario pulsa `Search`.
4. `Search.vue` emite:

```js
this.$emit('search', this.search, this.type)
```

5. `Main.vue` recibe el evento y llama a:

```js
LastFM.getSearchFunction('track')
```

6. Last.fm ejecuta `track.search`.
7. La respuesta pasa por `Adapt.adaptTracks`.
8. `Main.vue` guarda:

```js
this.results = results
this.type = 'track'
this.hasSearch = true
this.loading = false
```

9. `Result.vue` detecta `type === 'track'`.
10. Renderiza una lista de `Song.vue`.
11. Usuario pulsa una cancion.
12. `Song.vue` comprueba si ya esta seleccionada o en playlist.
13. Si no esta, despacha:

```js
this.$store.dispatch('addOrPlaySong', {
  artist,
  track,
  image
})
```

14. Vuex construye la busqueda para YouTube.
15. YouTube devuelve hasta 5 resultados.
16. Vuex toma el primer resultado.
17. Vuex hace commit:

```js
context.commit('addSong', {
  artist,
  track,
  image,
  youtubeId,
  thumbnail
})
```

18. Si era la primera cancion, `store.getters.playing` ahora apunta a esa entrada.
19. `Player.vue` detecta el cambio.
20. `Player.vue` llama:

```js
this.$youtube.player.load(youtubeId, true)
```

21. `YouTubePlayer` carga el iframe si aun no existe.
22. YouTube empieza a reproducir.
23. `Player.vue` marca `isPlaying = true`.
24. La barra de progreso recibe tiempo actual cada 200 ms.
25. Si el usuario pulsa pause, se llama a `pauseVideo`.
26. Si el usuario mueve el progreso, se llama a `seekTo`.
27. Si el usuario cambia volumen, se llama a `setVolume`.
28. Al terminar, se intenta pasar a la siguiente cancion.

## Eventos internos

### Eventos de componentes

`Search.vue`:

- `search`
- `resetSearch`

`Result.vue`:

- `changeCountry`

`ButtonsPanel.vue`:

- `play`
- `pause`

`ProgressBar.vue`:

- `changeTime`

`SoundControl.vue`:

- `changeVolume`
- `mute`
- `unmute`

`Player.vue`:

- `show-player`

`DeleteButton.vue`:

- `click`

### Bus global

Archivo:

```text
src/utils/vue-bus.js
```

Instala:

```js
Vue.prototype.$bus = new Vue()
```

Eventos usados:

- `api-change-volume`
- `api-change-mute`

`Player.vue` los emite cuando la API de YouTube esta lista.

`SoundControl.vue` y `VolumeBar.vue` los escuchan para sincronizar estado inicial de volumen y mute.

## Puntos fuertes del proyecto actual

- Separacion simple entre rutas, componentes, APIs y store.
- Buen objetivo de aprendizaje: Vue, Vuex, Vue Router, Webpack, APIs externas, PWA e IndexedDB.
- La app es facil de ejecutar como SPA sin backend.
- El adaptador de Last.fm evita que los componentes dependan directamente de la forma cruda de la API.
- El wrapper de YouTube concentra la logica del iframe en una clase.
- La cache IndexedDB reduce llamadas a Last.fm y YouTube.
- El reproductor tiene controles completos para una app pequena.
- El loader inicial esta integrado con la experiencia visual.
- Hay un pipeline propio para iconos y evita cargar toda la libreria de Font Awesome en runtime.

## Problemas, riesgos y deuda tecnica

### 1. API keys y shared secret en cliente

Los archivos de config contienen keys directamente en el bundle:

```text
src/api/lastfm/config.js
src/api/youtube/api.js
```

En una SPA, cualquier key incluida en el cliente es publica.

Riesgos:

- abuso de cuota,
- bloqueo de key,
- exposicion innecesaria del `sharedSecret` de Last.fm,
- dificultad para rotar credenciales.

Mejora:

- mover keys a variables de entorno para desarrollo,
- restringir la key de YouTube por dominio en Google Cloud,
- eliminar `sharedSecret` del cliente si no se usa,
- considerar un backend/proxy para peticiones sensibles.

### 2. Construccion manual de URLs

El codigo concatena parametros con strings.

Ejemplo:

```js
const paramToUrl = (name, value) => name + (value ? '=' + value : '');
```

Riesgos:

- caracteres especiales mal codificados,
- busquedas con `&`, `?`, `#`, `+` o espacios raros,
- bugs dificiles con nombres de artistas o albumes.

Mejora:

- usar `URL` y `URLSearchParams`.

### 3. Sin gestion robusta de errores

Muchas llamadas hacen:

```js
apiCall().then(...)
```

sin `catch`.

Si falla Last.fm, YouTube, IndexedDB o el fetch:

- el loader puede quedarse activo,
- la UI puede quedar vacia,
- el usuario no ve mensaje claro,
- puede haber errores en consola.

Mejora:

- estados `loading`, `error`, `empty`,
- `try/catch`,
- mensajes recuperables,
- boton de reintento,
- logging centralizado.

### 4. YouTube toma siempre el primer resultado

`addOrPlaySong` usa:

```js
const youtubeId = results[0].id.videoId;
```

Riesgos:

- puede reproducir un video incorrecto,
- puede elegir un remix, live, cover o letra,
- puede fallar si `results` esta vacio,
- puede elegir un resultado no reproducible en iframe.

Mejora:

- validar `results.length`,
- filtrar por tipo video,
- pedir `videoEmbeddable` si se usa otro endpoint,
- mostrar opciones al usuario,
- permitir reportar/cambiar match,
- mejorar query con `"artist track official audio"` o heuristicas configurables.

### 5. El wrapper carga una URL versionada del widget de YouTube

El loader usa una URL concreta:

```text
https://www.youtube.com/s/player/be9c9f3b/www-widgetapi.vflset/www-widgetapi.js
```

Riesgo:

- puede romperse si YouTube cambia esa ruta o version.

Mejora:

- usar la API oficial:

```text
https://www.youtube.com/iframe_api
```

### 6. La playlist no persiste

El estado vive solo en Vuex.

Al recargar:

- se pierde playlist,
- se pierde cancion activa,
- se pierde volumen,
- se pierde mute.

Mejora:

- persistir playlist en `localStorage` o IndexedDB,
- persistir volumen/mute,
- restaurar ultima sesion de forma controlada.

### 7. Bug probable al eliminar canciones antes de la actual

Mutation:

```js
removeSong (state, index) {
  if (index === state.playing && state.playing > 0) {
    state.playing--;
  }
  state.songs.splice(index, 1);
}
```

Si la cancion actual esta en indice 3 y se elimina la cancion en indice 1, el indice actual deberia pasar a 2. El codigo no lo ajusta.

Resultado posible:

- salta a otra cancion,
- el indice apunta a una entrada distinta,
- si se elimina cerca del final, puede quedar fuera de rango.

Mejora:

```js
if (index < state.playing) state.playing--;
else if (index === state.playing && state.playing > 0) state.playing--;
```

Y despues asegurar:

```js
state.playing = Math.max(0, Math.min(state.playing, state.songs.length - 1));
```

### 8. Keys de album indefinidas en listas

`Result.vue` usa:

```html
<Album v-for="album in albums" :key="album.id" :album="album" />
```

Pero el adaptador de albumes no genera `id`.

Lo mismo ocurre en `components/artist/Albums.vue`.

Riesgos:

- warnings de Vue,
- render menos eficiente,
- bugs al reordenar listas.

Mejora:

- usar `album.mbid` si existe,
- generar id estable con `artist + album.name`,
- incluir `url` o `mbid` en el adaptador.

### 9. `AlbumTracks` pasa una prop que `Song` no declara

`src/components/album/Tracks.vue`:

```html
<Song :track="track" :image="image" />
```

Pero `Song.vue` no tiene prop `image`.

Mejora:

- quitar esa prop,
- o permitir imagen fallback en `Song`,
- o ajustar el adaptador para que cada track tenga imagen correcta.

### 10. `tracksArray` ignora la imagen fallback

`albumDetail` llama:

```js
tracksArray(album.tracks.track, findImage(album.image, 'medium'))
```

Pero `tracksArray` solo acepta `tracks` y no usa el segundo parametro.

Mejora:

- cambiar firma a `tracksArray(tracks, fallbackImage)`,
- usar `fallbackImage` si el track no trae imagen util.

### 11. Posible bug en wiki de album

En `albumDetail`:

```js
const bio = album.wiki.summary || album.wiki.bio.content;
```

Probablemente deberia ser:

```js
const bio = album.wiki.summary || album.wiki.content;
```

### 12. Sin estados vacios

Si una busqueda no devuelve resultados, no hay mensaje especifico.

Mejora:

- mostrar "No results",
- sugerir cambiar tipo de busqueda,
- mantener ultima query visible.

### 13. Sin cancelacion de peticiones

Si el usuario lanza busquedas rapidamente, una respuesta antigua puede llegar despues de una nueva y pisar resultados.

Mejora:

- usar `AbortController`,
- usar contador de request activa,
- usar una libreria de query/cache.

### 14. Accesibilidad limitada

Hay elementos clicables implementados como `<a>` sin `href` o iconos `<i>` con handlers.

Riesgos:

- peor navegacion con teclado,
- falta de roles,
- lectores de pantalla sin contexto,
- imagenes sin `alt`.

Mejora:

- usar `<button>` para acciones,
- usar enlaces reales para navegacion,
- agregar `aria-label`,
- agregar `alt`,
- estados focus visibles,
- soporte de teclado.

### 15. `disablePageVisibility` intercepta eventos globales

El codigo intenta evitar que YouTube pare al minimizar en movil:

```js
event.stopImmediatePropagation();
event.preventDefault();
```

Riesgos:

- comportamiento inesperado del navegador,
- conflictos con librerias,
- problemas de privacidad/UX,
- logs en consola.

Mejora:

- revisar si sigue siendo necesario,
- eliminar si no aporta,
- usar Media Session API cuando aplique,
- aceptar limitaciones de reproduccion en background segun plataforma.

### 16. Cache IndexedDB simple

La cache actual es util, pero tiene limitaciones:

- no hay limpieza de entradas antiguas,
- no hay versionado de esquema real,
- no hay limite de tamano,
- no distingue errores temporales de datos invalidos,
- devuelve un objeto parcial, no una `Response` real.

Mejora:

- usar `localforage`, `idb-keyval` o una capa propia mas completa,
- guardar metadata,
- exponer invalidacion manual,
- limpiar expirados.

### 17. Store acoplado a servicios

Vuex llama directamente a `this.$youtube`.

Esto dificulta:

- tests unitarios,
- mocks,
- reutilizacion,
- migracion a otro proveedor.

Mejora:

- inyectar servicios de forma explicita,
- separar actions de infraestructura,
- crear casos de uso puros.

### 18. Componentes con responsabilidad mezclada

Ejemplo: `Song.vue`:

- renderiza UI,
- calcula estado visual,
- consulta Vuex,
- despacha actions,
- transforma valores con `str`.

Mejora:

- separar componente presentacional y contenedor,
- pasar callbacks desde padre,
- centralizar logica de playlist.

### 19. Textos hardcodeados

Los textos estan en componentes:

- `Search`,
- `Playing`,
- `Popular Tracks`,
- `Albums`,
- `Similar Artists`,
- etc.

Mejora:

- crear archivo de mensajes,
- preparar i18n si se quiere espanol/ingles.

### 20. Sin tests

No hay suite de tests.

Mejora:

- unit tests para adaptadores,
- unit tests para store,
- tests de cache con IndexedDB mock,
- tests de componentes clave,
- E2E con Playwright.

## Como lo reharia hoy

### Opcion conservadora recomendada

Mantener Vue, pero modernizar:

```text
Vue 3
Vite
Pinia
Vue Router 4
TypeScript
Vitest
Playwright
```

Por que:

- respeta el modelo mental del proyecto actual,
- reduce complejidad de Webpack,
- facilita tipado de respuestas externas,
- mejora mantenibilidad,
- permite code splitting mas simple,
- Pinia es mas ergonomico que Vuex para Vue 3.

### Opcion alternativa

Si se quisiera rehacer como producto mas amplio:

```text
Next.js o Nuxt
Backend/serverless proxy
Base de datos ligera para usuarios/playlists
Auth opcional
```

Pero para rehacer este programa manteniendo alcance, Vue 3 + Vite es suficiente.

## Arquitectura propuesta

Estructura sugerida:

```text
src/
  app/
    App.vue
    router.ts
    providers.ts
  assets/
  components/
    common/
    layout/
  features/
    search/
      SearchForm.vue
      SearchResults.vue
      search.store.ts
    artist/
      ArtistCard.vue
      ArtistDetailPage.vue
      artist.api.ts
      artist.types.ts
    album/
      AlbumCard.vue
      AlbumDetailPage.vue
      album.api.ts
      album.types.ts
    player/
      PlayerBar.vue
      ProgressBar.vue
      VolumeControl.vue
      youtube-player.ts
      player.store.ts
    playlist/
      PlaylistPage.vue
      PlaylistSong.vue
      playlist.store.ts
  services/
    lastfm/
      lastfm.client.ts
      lastfm.adapters.ts
      lastfm.types.ts
    youtube/
      youtube-search.client.ts
      youtube-player.client.ts
      youtube.types.ts
    cache/
      cache.ts
      cache.types.ts
  shared/
    utils/
    constants/
    composables/
```

### Separacion por dominio

Separaria:

- `features/search`: busqueda y resultados.
- `features/artist`: ficha y componentes de artista.
- `features/album`: ficha y componentes de album.
- `features/playlist`: cola de reproduccion.
- `features/player`: reproduccion.
- `services`: APIs externas y cache.

La UI no deberia conocer la forma cruda de Last.fm ni YouTube.

### Modelos de dominio

Ejemplo en TypeScript:

```ts
export interface ArtistSummary {
  id: string;
  name: string;
  imageUrl: string;
  mbid?: string;
}

export interface ArtistDetail extends ArtistSummary {
  listeners: number;
  playCount: number;
  tags: Tag[];
  biography?: string;
  similarArtists: ArtistSummary[];
  lastfmUrl: string;
}

export interface AlbumSummary {
  id: string;
  name: string;
  artistName: string;
  imageUrl: string;
  mbid?: string;
}

export interface AlbumDetail extends AlbumSummary {
  listeners: number;
  playCount: number;
  tags: Tag[];
  summary?: string;
  tracks: TrackSummary[];
  lastfmUrl: string;
}

export interface TrackSummary {
  id: string;
  name: string;
  artistName: string;
  imageUrl: string;
  mbid?: string;
}

export interface PlaylistSong {
  id: string;
  artistName: string;
  trackName: string;
  imageUrl: string;
  youtubeVideoId: string;
  youtubeThumbnailUrl?: string;
}
```

Ventaja:

- Los componentes reciben datos estables.
- Las keys de Vue estan garantizadas.
- Las APIs pueden cambiar sin romper toda la UI.

## API layer propuesta

### Cliente Last.fm

Usar `URLSearchParams`:

```ts
function buildLastfmUrl(method: string, params: Record<string, string | number>) {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');

  url.search = new URLSearchParams({
    method,
    api_key: import.meta.env.VITE_LASTFM_API_KEY,
    format: 'json',
    ...Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)])
    )
  }).toString();

  return url.toString();
}
```

### Fetch seguro

Crear una funcion comun:

```ts
async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, body);
  }

  return body as T;
}
```

### Validacion de respuestas

Idealmente validar respuestas externas con una libreria como Zod.

Motivo:

- Last.fm puede devolver objetos o arrays segun cantidad de resultados.
- Algunos campos pueden faltar.
- YouTube puede devolver items que no sean videos.

### Cache propuesta

Opcion simple:

- `idb-keyval`,
- clave por URL,
- valor `{ data, savedAt, ttl }`.

Opcion mas completa:

- TanStack Query para estado remoto,
- persistencia opcional en IndexedDB,
- reintentos,
- invalidacion,
- stale time.

Para esta app, una capa propia pequena tambien seria suficiente.

API sugerida:

```ts
interface CacheEntry<T> {
  data: T;
  savedAt: number;
  ttl: number;
}

async function cachedRequest<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
  const cached = await cache.get<CacheEntry<T>>(key);

  if (cached && Date.now() - cached.savedAt < cached.ttl) {
    return cached.data;
  }

  const data = await loader();
  await cache.set(key, { data, savedAt: Date.now(), ttl });
  return data;
}
```

## Store propuesta

Separaria al menos tres stores:

### `playlistStore`

Responsable de:

- lista de canciones,
- cancion actual,
- agregar,
- eliminar,
- seleccionar,
- siguiente,
- anterior,
- persistencia.

Estado:

```ts
interface PlaylistState {
  songs: PlaylistSong[];
  currentSongId: string | null;
}
```

Mejor usar id en lugar de indice.

Ventajas:

- eliminar canciones no rompe indices,
- seleccionar es mas robusto,
- persistir es mas simple.

### `playerStore`

Responsable de:

- `isPlaying`,
- `currentTime`,
- `duration`,
- `volume`,
- `muted`,
- `repeatMode`,
- `shuffle`.

### `searchStore`

Responsable de:

- query,
- tipo,
- pais,
- resultados,
- loading,
- error,
- empty state.

## Reproductor propuesto

### Loader oficial

Usar:

```text
https://www.youtube.com/iframe_api
```

Crear una promesa singleton:

```ts
let youtubeApiPromise: Promise<typeof YT> | null = null;

export function loadYouTubeIframeApi() {
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('Could not load YouTube iframe API'));
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
}
```

### Manejo de errores

YouTube iframe API tiene evento `onError`.

Se deberia manejar:

- video no encontrado,
- video privado,
- no embeddable,
- restriccion regional,
- error HTML5.

Si falla un video:

- marcar cancion como no reproducible,
- intentar siguiente resultado,
- o pedir al usuario elegir otro video.

### Matching de canciones

El matching actual es:

```text
artist + track
```

Mejor:

- normalizar query,
- probar variantes:
  - `"artist track official audio"`,
  - `"artist track official video"`,
  - `"artist track topic"`,
- penalizar:
  - cover,
  - karaoke,
  - remix si no esta en el nombre,
  - live si no esta en el nombre.

Tambien se podria guardar el match elegido por el usuario.

## UI/UX propuesta

### Pantalla principal

Mejoras:

- Input con debounce opcional.
- Boton de limpiar visible.
- Query reflejada en URL:

```text
/?type=track&q=radiohead
```

- Estado vacio.
- Estado error.
- Skeleton o spinner local.
- Mas paises.
- Busqueda inicial configurable.

### Resultados

Mejoras:

- Mostrar cantidad de resultados.
- Distinguir visualmente artista, album y track.
- Lazy loading de imagenes.
- Alt text.
- Boton explicito "add to playlist".
- Boton explicito "play now".

### Detalle de artista

Mejoras:

- Mostrar fallback si no hay biografia.
- Ocultar secciones vacias.
- Mostrar errores por seccion.
- Boton para reproducir top tracks.
- Boton para agregar top tracks a playlist.
- Mejorar layout responsive.

### Detalle de album

Mejoras:

- Boton "play album".
- Boton "add album".
- Duracion de tracks si se obtiene.
- Orden correcto de tracks.
- Imagen fallback para tracks.

### Player

Mejoras:

- Player sticky/fijo mas robusto.
- Responsive real para movil.
- Teclas:
  - espacio play/pause,
  - flechas para seek,
  - `m` mute.
- Media Session API para controles del sistema.
- Repeat one/all.
- Shuffle.
- Boton para limpiar playlist.
- Confirmacion o undo al borrar.

## Accesibilidad recomendada

Cambios concretos:

- Usar botones para acciones.
- Usar `router-link` solo para navegacion.
- Agregar `alt` en imagenes:

```html
<img :src="artist.imageUrl" :alt="artist.name">
```

- Agregar `aria-label` en botones de icono:

```html
<button aria-label="Play">
```

- Asegurar foco visible.
- Permitir navegacion completa con teclado.
- No depender solo de hover para mostrar controles.
- Respetar `prefers-reduced-motion`.
- Evitar textos dentro de iconos sin etiqueta.
- Revisar contraste.

## Seguridad y privacidad

### Keys

- No guardar `sharedSecret` de Last.fm en cliente.
- Usar variables de entorno.
- Restringir key de YouTube por dominio.
- Rotar keys expuestas si el proyecto se publica.

### CSP

Si se despliega como app real, definir Content Security Policy para:

- Last.fm,
- YouTube,
- Google Fonts,
- Bing thumbnails si se mantiene,
- assets propios.

### Bing thumbnails

El workaround de Bing puede ser fragil:

- no garantiza derechos de uso,
- puede devolver imagen incorrecta,
- depende de endpoint no pensado como API estable.

Alternativas:

- MusicBrainz + Cover Art Archive para albumes,
- Spotify API si hay login/client credentials,
- Deezer API para previews/imagenes,
- propia cache de imagenes permitidas,
- placeholders generados por iniciales/gradiente.

## Testing recomendado

### Unit tests

Prioridad alta:

- `lastfm.adapters`
- `buildSearchQuery`
- store de playlist
- cache TTL
- helpers de URL

Casos:

- artista sin `mbid`,
- artista sin imagen,
- album sin tracks,
- album con un solo track,
- busqueda vacia,
- YouTube sin resultados,
- eliminar cancion antes de la actual,
- eliminar cancion actual,
- eliminar ultima cancion.

### Component tests

Prioridad media:

- `SearchForm`,
- `SearchResults`,
- `Song`,
- `PlayerBar`,
- `ProgressBar`,
- `VolumeControl`.

### E2E

Con Playwright:

1. Cargar home.
2. Mock de Last.fm para top artists.
3. Buscar track.
4. Agregar cancion.
5. Mock de YouTube search.
6. Verificar que aparece player.
7. Abrir playlist.
8. Cambiar cancion.
9. Eliminar cancion.
10. Verificar estados vacios y errores.

## Plan para rehacerlo desde cero

### Fase 1: Definir alcance

Decidir explicitamente:

- Si se mantiene solo frontend.
- Si habra backend/proxy.
- Si la playlist debe persistir.
- Si se quiere login.
- Si se mantiene YouTube como fuente de reproduccion.
- Si se mantiene Last.fm como fuente principal de metadata.

Para una primera version, recomendacion:

- solo frontend,
- Vue 3 + Vite + Pinia,
- Last.fm + YouTube,
- playlist persistida en localStorage,
- cache IndexedDB,
- sin login.

### Fase 2: Crear base tecnica

Crear:

- Vite,
- Vue 3,
- TypeScript,
- Router,
- Pinia,
- Vitest,
- Playwright,
- ESLint,
- Stylelint o Prettier.

Configurar:

- variables `.env`,
- aliases,
- build para GitHub Pages,
- PWA si se mantiene.

### Fase 3: Modelos y servicios

Implementar:

- modelos `Artist`, `Album`, `Track`, `PlaylistSong`,
- cliente Last.fm,
- cliente YouTube search,
- loader de YouTube iframe,
- cache,
- adaptadores.

Antes de UI, escribir tests de adaptadores.

### Fase 4: Stores

Implementar:

- `searchStore`,
- `playlistStore`,
- `playerStore`.

Probar:

- agregar cancion,
- evitar duplicados,
- seleccionar por id,
- borrar,
- siguiente/anterior,
- persistencia.

### Fase 5: UI principal

Construir:

- layout,
- header,
- buscador,
- resultados,
- cards,
- estados loading/error/empty.

### Fase 6: Detalles

Construir:

- artista,
- album,
- secciones asincronas,
- fallbacks,
- navegacion.

### Fase 7: Reproductor

Construir:

- wrapper YouTube,
- player bar,
- progress,
- volume,
- playlist page,
- manejo de errores de video.

### Fase 8: PWA y polish

Agregar:

- manifest,
- service worker,
- iconos,
- offline shell,
- responsive,
- accesibilidad,
- performance.

### Fase 9: QA

Ejecutar:

- unit tests,
- component tests,
- E2E,
- lighthouse,
- pruebas manuales en movil,
- pruebas con red lenta,
- pruebas con APIs caidas.

## Checklist de funcionalidades para la nueva version

MVP:

- Home con top artists por pais.
- Busqueda por track, album y artist.
- Resultados con loading, error y empty.
- Ficha de artista.
- Ficha de album.
- Agregar track a playlist.
- Buscar video en YouTube.
- Reproducir con iframe.
- Play/pause.
- Siguiente/anterior.
- Seek.
- Volumen/mute.
- Playlist editable.
- Persistencia local de playlist.

Version 1.1:

- Seleccionar video de YouTube alternativo.
- Shuffle.
- Repeat.
- Play all de artista/album.
- Mas paises.
- Query params en URL.
- Media Session API.
- Mejor responsive.
- Accesibilidad completa.

Version 1.2:

- Backend proxy opcional.
- Cache compartida.
- Usuarios/login opcional.
- Playlists guardadas.
- Favoritos.
- Historial.

## Comandos actuales

Instalar:

```bash
npm install
```

Desarrollo:

```bash
npm run start
```

Desarrollo accesible desde red local:

```bash
npm run start:local
```

Build:

```bash
npm run build
```

Build para GitHub Pages:

```bash
npm run build:gh-pages
```

Servir build local:

```bash
npm run start:static
```

Lint:

```bash
npm run lint
```

Actualizar iconos incluidos:

```bash
npm run icons:update-included
```

Agregar icono:

```bash
npm run icons:add -- https://fontawesome.com/v5.15/icons/play?style=solid
```

## Archivos mas importantes

Para entender la app actual rapidamente, leer en este orden:

1. `src/index.js`
2. `src/App.vue`
3. `src/routes/index.js`
4. `src/routes/Main.vue`
5. `src/store/index.js`
6. `src/api/lastfm/services.js`
7. `src/api/lastfm/adapt.js`
8. `src/api/youtube/api.js`
9. `src/api/youtube/player.js`
10. `src/components/player/Player.vue`
11. `src/components/Song.vue`
12. `src/routes/ArtistDetail.vue`
13. `src/routes/AlbumDetail.vue`
14. `src/api/utils/fetch-cache.js`
15. `webpack.config.js`

## Recomendacion final

Si el objetivo es rehacer el programa aprendiendo y dejandolo mantenible, no copiaria el codigo archivo por archivo.

Mantendria estas ideas:

- Last.fm como fuente de descubrimiento.
- YouTube como reproduccion.
- Playlist local.
- Cache con TTL.
- Fichas de artista y album.
- PWA opcional.

Pero cambiaria estas bases:

- Vue 2 -> Vue 3.
- Webpack manual -> Vite.
- Vuex con indices -> Pinia con ids estables.
- URLs manuales -> `URLSearchParams`.
- APIs sin errores -> clientes con `try/catch` y estados.
- Wrapper YouTube versionado -> loader oficial.
- Playlist volatil -> persistencia local.
- Componentes acoplados -> separacion entre dominio, servicios y UI.
- Sin tests -> tests de adaptadores, stores y flujos criticos.

La aplicacion actual es una buena prueba de concepto. Para una version nueva, la prioridad deberia ser hacer solidos los puntos donde hoy puede romperse: errores de API, matching de YouTube, persistencia de playlist, accesibilidad, keys publicas y modelado de datos.
