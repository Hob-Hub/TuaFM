"""Infraestructura compartida por los scrapers de charts-db.

Solo vive aquí lo que es **idéntico** entre fuentes y de bajo riesgo: salida en
UTF-8, logging, sesión HTTP y descarga con reintentos/429. La normalización de
texto (`normalize_key`, `clean_text`) y el modelo de datos (clase DB, parseo) se
quedan en cada `sources/*.py` porque tienen variaciones reales por fuente
(apóstrofos, refs `[..]`, columnas del esquema, etc.).
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

import requests


def configure_output_encoding() -> None:
    """Fuerza UTF-8 en stdout/stderr (Windows y terminales no-UTF8)."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def setup_logging(logfile: str | Path, name: Optional[str] = None) -> logging.Logger:
    """Logger a fichero + consola con el formato común de los scrapers."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(str(logfile), encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger(name or "scraper")


def build_session(user_agent: str, accept_language: str = "en-US,en;q=0.9") -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent, "Accept-Language": accept_language})
    return session


def fetch_url(
    url: str,
    session: requests.Session,
    *,
    retries: int = 4,
    timeout: int = 30,
    log: Optional[logging.Logger] = None,
) -> Tuple[Optional[str], str]:
    """Descarga `url` con reintentos y respeto a 429/Retry-After.

    Devuelve `(html | None, url_final)`. `url_final` es la URL tras redirecciones
    (o la original si falló), útil para guardar la fuente real de cada chart.
    """
    log = log or logging.getLogger("scraper")
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, timeout=timeout)
            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                wait = int(retry_after) if retry_after and retry_after.isdigit() else min(60, 10 * attempt)
                log.warning(f"429 Too Many Requests en {url}; esperando {wait}s (intento {attempt}/{retries})")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.text, r.url
        except requests.RequestException as exc:
            if attempt < retries:
                wait = min(30, 5 * attempt)
                log.warning(f"HTTP error {url}: {exc}; reintento en {wait}s")
                time.sleep(wait)
                continue
            log.error(f"HTTP error {url}: {exc}")
            return None, url
    log.error(f"HTTP error {url}: agotados reintentos")
    return None, url
