"""Shared HTTP client with retries, timeouts, and optional TTL cache."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from . import config

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: str) -> Any | None:
    if not config.CACHE_ENABLED:
        return None
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.time() >= expires_at:
            del _cache[key]
            return None
        return value


def _cache_set(key: str, value: Any, ttl_sec: int) -> None:
    if not config.CACHE_ENABLED or ttl_sec <= 0:
        return
    with _cache_lock:
        _cache[key] = (time.time() + ttl_sec, value)


def _build_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": config.USER_AGENT,
    }
    if extra:
        headers.update(extra)
    return headers


def build_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    return _build_headers(extra)


def get_json(
    url: str,
    params: dict[str, str | int | float] | None = None,
    *,
    timeout: float | None = None,
    retries: int | None = None,
    cache_ttl: int = 0,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """GET JSON with optional cache and retries. Returns {data} or {error, status?}."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"

    cache_key = f"GET:{url}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return {"data": cached, "cached": True}

    timeout = timeout if timeout is not None else config.HTTP_TIMEOUT_SEC
    retries = retries if retries is not None else config.HTTP_RETRIES
    last_error = "unknown error"

    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=_build_headers(headers))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if cache_ttl > 0:
                _cache_set(cache_key, payload, cache_ttl)
            return {"data": payload, "cached": False}
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}: {exc.reason}"
            if exc.code < 500 or attempt >= retries:
                return {"error": last_error, "status": exc.code}
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            last_error = str(exc)
            if attempt >= retries:
                return {"error": last_error}

        time.sleep(0.4 * (attempt + 1))

    return {"error": last_error}


def probe_url(
    url: str,
    params: dict[str, str | int] | None = None,
    *,
    timeout: float = 8,
) -> dict[str, Any]:
    """Lightweight reachability check."""
    started = time.perf_counter()
    result = get_json(url, params, timeout=timeout, retries=0, cache_ttl=0)
    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    if result.get("error"):
        return {"status": "error", "error": result["error"], "latency_ms": latency_ms}
    return {"status": "ok", "latency_ms": latency_ms}
