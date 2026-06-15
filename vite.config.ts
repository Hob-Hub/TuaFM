import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // 'prompt': es un reproductor → no auto-recargamos a media canción.
      // El usuario decide cuándo aplicar la versión nueva (toast en PwaUpdatePrompt).
      registerType: 'prompt',
      injectRegister: false, // registramos a mano vía useRegisterSW en el componente
      // Assets sueltos (no entran en el glob de precache de Workbox) que igualmente
      // queremos servibles offline: favicons e iconos de iOS.
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'TuaFM',
        short_name: 'TuaFM',
        description: 'Tu radio imaginaria construida desde los charts reales',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0a12',
        theme_color: '#0a0a12',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Precache solo el shell. El catálogo/charts (8 MB de JSON) NO van aquí:
        // se sirven con StaleWhileRevalidate en runtime (ver runtimeCaching).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        // No devolver index.html para datos: si falta un JSON, que falle como JSON.
        navigateFallbackDenylist: [/^\/(catalog|charts)\//],
        runtimeCaching: [
          {
            // Catálogo y charts estáticos: rápido desde caché, refresca en segundo plano.
            urlPattern: ({ url }) => url.pathname.startsWith('/catalog/') || url.pathname.startsWith('/charts/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'tuafm-data',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 } // 7 días
            }
          },
          {
            // Hoja de estilos de Google Fonts.
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' }
          },
          {
            // Ficheros de fuentes (inmutables).
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }, // 1 año
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Carátulas y fotos de artista (Last.fm/Deezer/Cover Art Archive…).
            // CacheFirst a propósito: StaleWhileRevalidate revalidaba en 2º plano
            // CADA imagen ya cacheada, y esas peticiones compiten por el ancho de
            // banda con los segmentos de YouTube justo al pasar de canción → cortes
            // de buffer. Una carátula rota/opaca ya no queda atrapada: "Borrar caché"
            // purga este CacheStorage (ver clearArtworkCache en cache.maintenance.ts).
            // El tope de entradas es alto para no expulsar carátulas en colas largas.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'tuafm-artwork',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 días
              cacheableResponse: { statuses: [0, 200] }
            }
          }
          // YouTube (iframe): deliberadamente SIN regla → el SW no lo intercepta.
        ]
      }
    })
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'pinia-plugin-persistedstate']
        }
      }
    }
  }
})
