"""Environment-based configuration for GWAS PrePubMatch server."""

from __future__ import annotations

import os

API_VERSION = "0.4.0"
SCHEMA_VERSION = "3.1.0"

HOST = os.environ.get("PREPUBMATCH_HOST", "127.0.0.1")
PORT = int(os.environ.get("PREPUBMATCH_PORT", "8000"))
WORKERS = int(os.environ.get("PREPUBMATCH_WORKERS", "1"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "PREPUBMATCH_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173",
    ).split(",")
    if origin.strip()
]

HTTP_TIMEOUT_SEC = float(os.environ.get("PREPUBMATCH_HTTP_TIMEOUT", "20"))
HTTP_RETRIES = int(os.environ.get("PREPUBMATCH_HTTP_RETRIES", "2"))
CACHE_TTL_CATALOG_SEC = int(os.environ.get("PREPUBMATCH_CACHE_TTL_CATALOG", "3600"))
CACHE_TTL_LITERATURE_SEC = int(os.environ.get("PREPUBMATCH_CACHE_TTL_LITERATURE", "7200"))
CACHE_ENABLED = os.environ.get("PREPUBMATCH_CACHE", "true").lower() not in ("0", "false", "no")

OPENALEX_API_KEY = os.environ.get("OPENALEX_API_KEY", "")
NCBI_API_KEY = os.environ.get("NCBI_API_KEY", "")
OPENALEX_MAILTO = os.environ.get("OPENALEX_MAILTO", "")

USER_AGENT = os.environ.get(
    "PREPUBMATCH_USER_AGENT",
    f"GWAS-PrePubMatch/{API_VERSION} (https://github.com/agihouse-hackathon-30may2026)",
)
