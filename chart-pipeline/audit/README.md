# audit — auditoría de reproducción de YouTube

Comprueba que los `youtubeVideoId` del bundle **se reproducen de verdad**: abre
un Chromium real con la IFrame API de YouTube y detecta vídeos que no arrancan,
lanzan error del player o no avanzan el tiempo. Es más estricto que el oEmbed de
[`../youtube-tools/validate_oembed.py`](../youtube-tools/validate_oembed.py)
(que solo confirma que el vídeo existe y es embebible), pero más lento.

## Instalación

```bash
cd chart-pipeline/audit
npm install          # instala playwright y, vía postinstall, el navegador chromium
```

## Uso

```bash
node playback-audit.mjs --chart es        # audita las pistas de public/charts/es.json
node playback-audit.mjs --all             # audita todo el catálogo
node playback-audit.mjs --ids 963,469     # ids concretos del catálogo
node playback-audit-batches.mjs --all     # por lotes, reanudable (catálogo grande)
node playback-audit.mjs --help            # todas las opciones
```

Los reportes se escriben en `out/` (ignorado por git). Las pistas que fallen se
pasan luego a [`../youtube-tools/`](../youtube-tools/) para buscar reemplazos, que
se validan de nuevo aquí y se aplican a [`../overrides.json`](../overrides.json).

> No puede probar que el audio sea audible (YouTube va en un iframe cross-origin),
> pero captura los fallos de reproducción que el oEmbed no detecta.
