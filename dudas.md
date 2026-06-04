# TuaFM — Decisiones abiertas y mejoras pendientes

Lo que queda por decidir o por hacer. Lo ya aplicado se omite: vive en el código
y en el historial de git.

---

## Decisiones abiertas (son tuyas)

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

### Vite 6 vs 7/8
El build funciona en **Vite 6.4.3**. Existen Vite 7 (estable) y 8 (Rolldown/Oxc).
Subir aporta poco y arriesga incompatibilidades con Tailwind v4 / plugin-vue.
→ *Recomendación: quedarse en 6 hasta tener motivo.*

---

## Mejoras pendientes (priorizadas)

| Prioridad | Mejora | Notas |
|-----------|--------|-------|
| Media | **PWA instalable** (`vite-plugin-pwa`) | App offline-first; encaja con un reproductor |
| Media | **Más tests** | Hoy: núcleo puro (normalize, scoring, csv). Faltan componentes (Vitest + @vue/test-utils) y un e2e (Playwright) del flujo "crear playlist → importar → reproducir" |
| Media | **ESLint + Prettier** | No configurados |
| Baja | **CI** (GitHub Actions) | `build` + `test` en cada push |
| Baja | **Validación de respuestas de API** (zod) | Hoy se confía en los tipos TS |
| Baja | **Cancelación de peticiones** (AbortController) | Los servicios ya aceptan `signal`; falta cablearlo en búsquedas que se reescriben rápido |
| Baja | **Mejor selección de videoId de YouTube** | Hoy toma el primer resultado; podría filtrar por duración/categoría música |
| Baja | **i18n / textos centralizados** | Hoy en español hardcodeado |
