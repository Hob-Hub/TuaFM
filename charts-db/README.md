# charts-db

Scrapers que recogen las listas de éxitos de cada país en una **SQLite por
fuente**. Es la capa de **adquisición** del proyecto: no sabe nada de la app
TuaFM; solo produce `.db` que cumplen un contrato (la vista `v_chart`), que luego
consume `chart-pipeline/` para generar el bundle estático.

> Este directorio está pensado para vivir en **su propio repositorio** (hoy está
> dentro de TuaFM por comodidad). Su única salida hacia la app son los ficheros
> `.db`, que se copian a `TuaFM/data/` (ver el contrato en
> [`../data/README.md`](../data/README.md)).

## Estructura

```
charts-db/
  lib/common.py        Infra compartida: encoding UTF-8, logging, sesión HTTP,
                       fetch con reintentos/429. (Lo único 100% común.)
  sources/             Un scraper por fuente (parseo + modelo de datos propios).
    los40.py             España — LOS40 semanal (1969→hoy). Schema inline.
    billboard.py         EE.UU. — Billboard Year-End Hot 100 (Wikipedia).
    fimi.py              Italia — FIMI Top of the Music, Singoli (anual).
    snep.py              Francia — SNEP Top Singles (anual).
    fimi_weekly_reconstruct.py   Reconstruye años FIMI sin tabla anual oficial,
                                 a partir de las listas semanales.
  schema/              Esquema SQL por fuente (define tablas + la vista v_chart).
  queries/             Utilidades CLI de consulta/análisis sobre cada .db.
  docs/los40.md        Documentación detallada del scraper de LOS40.
  requirements.txt
```

## Instalación

```bash
cd charts-db
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Uso

Cada scraper es un CLI independiente, **reanudable** (salta lo ya almacenado) y
cortés (`--delay`). Por defecto escribe la `.db` en el directorio actual; cópiala
luego a `TuaFM/data/` con el nombre que espera el pipeline.

```bash
# España (semanal, todo el histórico). Ver docs/los40.md para opciones.
python sources/los40.py --start 2004-01-01

# EE.UU. (anual, por defecto 1958 → año anterior)
python sources/billboard.py

# Italia (anual) + reconstrucción de años sin tabla oficial
python sources/fimi.py
python sources/fimi_weekly_reconstruct.py

# Francia (anual)
python sources/snep.py

# Un rango / un solo período (test rápido)
python sources/billboard.py --year 2020
python sources/fimi.py --start 2010 --end 2020
```

Consultas de ejemplo:

```bash
python queries/los40.py --help
python queries/billboard.py --help
```

## El contrato: vista `v_chart`

El pipeline **no lee las tablas internas**; solo la vista `v_chart`. Cada scraper
modela sus tablas como quiera mientras exponga esa vista con, como mínimo:
`chart_date, position, song, artists` (y opcionalmente `cover_url`,
`youtube_url`, `album`, `album_year`). La especificación completa está en
[`../data/README.md`](../data/README.md), que es **la interfaz** entre este
proyecto y TuaFM.

## Diseño

- **`lib/common.py` solo contiene lo idéntico** entre fuentes (infra HTTP +
  logging). La normalización de texto (`normalize_key`, `clean_text`) y la capa
  de datos (clase `DB`, parseo) se quedan en cada `sources/*.py` **a propósito**:
  tienen diferencias reales por fuente (manejo de apóstrofos, refs `[..]` de
  Wikipedia, columnas distintas en el esquema, inversión de nombres en SNEP…).
  Unificarlas cambiaría las claves de dedup y el comportamiento del scraping.
- Los tres scrapers anuales (billboard/fimi/snep) comparten la **misma forma de
  esquema** (`tracks`, `artists`, `track_artists`, `year_end_charts`,
  `year_end_entries`, `scrape_log`), cada uno con columnas extra propias. Una
  futura `lib/yearend_db.py` podría factorizar la clase `DB` común, pero requiere
  una pasada de scraping real para validarla (no se hizo aquí por no poder
  re-ejecutar los scrapers contra las webs).
