"""Invoke Google Science Skills CLIs via uv."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path
from typing import Any

from .paths import EUROPEPMC_SKILL, OPENALEX_SKILL, PUBMED_SKILL, SKILLS_VENDOR

UV_TIMEOUT_SEC = 90


def _run_uv(cwd: Path, script: str, args: list[str]) -> tuple[int, str, str]:
    cmd = ["uv", "run", script, *args]
    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=UV_TIMEOUT_SEC,
        env=env,
    )
    return proc.returncode, proc.stdout, proc.stderr


def search_openalex(title: str, per_page: int = 10) -> dict[str, Any]:
    """literature-search-openalex skill: title search on works."""
    query = title.strip()[:200]
    if not query:
        return {"skill": "literature-search-openalex", "results": [], "error": "empty title"}

    code, stdout, stderr = _run_uv(
        OPENALEX_SKILL,
        "scripts/openalex_cli.py",
        [
            "filter", "works",
            "--search", query,
            "--per-page", str(min(per_page, 25)),
            "--select", "id,display_name,publication_year,doi,authorships,cited_by_count,primary_location",
        ],
    )
    if code != 0:
        return {
            "skill": "literature-search-openalex",
            "results": [],
            "error": stderr.strip() or stdout.strip() or f"exit {code}",
        }
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return {"skill": "literature-search-openalex", "results": [], "error": "invalid JSON from skill"}
    return {"skill": "literature-search-openalex", "results": data.get("results") or [], "meta": {"count": data.get("meta", {}).get("count")}}


def search_europepmc(title: str, max_results: int = 10) -> dict[str, Any]:
    """literature-search-europepmc skill API: title search (all access levels)."""
    import urllib.request

    title_q = title.replace('"', "").strip()[:120]
    if not title_q:
        return {"skill": "literature-search-europepmc", "results": [], "error": "empty title"}

    try:
        query = f'TITLE:"{title_q}"'
        url = (
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search?"
            + urllib.parse.urlencode({
                "query": query,
                "format": "json",
                "pageSize": min(max_results, 25),
                "resultType": "core",
            })
        )
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        results = data.get("resultList", {}).get("result", [])
        return {
            "skill": "literature-search-europepmc",
            "results": results[:max_results],
            "meta": {"hitCount": data.get("hitCount", 0)},
        }
    except Exception as exc:  # noqa: BLE001
        return {"skill": "literature-search-europepmc", "results": [], "error": str(exc)}


def search_pubmed(title: str, trait: str, max_results: int = 10) -> dict[str, Any]:
    """pubmed-database skill: search + fetch abstracts."""
    title = title.strip()[:200]
    if not title:
        return {"skill": "pubmed-database", "results": [], "error": "empty title"}

    query = f"({title}[Title])"

    with tempfile.TemporaryDirectory() as tmp:
        out_search = Path(tmp) / "pubmed_search.json"
        out_fetch = Path(tmp) / "pubmed_fetch.json"

        code, _, stderr = _run_uv(
            PUBMED_SKILL,
            "scripts/pubmed_api.py",
            [str(out_search), "search_pubmed", query, str(max_results), "relevance"],
        )
        if code != 0 or not out_search.is_file():
            return {"skill": "pubmed-database", "results": [], "error": stderr.strip() or f"search exit {code}"}

        pmids = json.loads(out_search.read_text())
        if isinstance(pmids, dict) and "error" in pmids:
            return {"skill": "pubmed-database", "results": [], "error": pmids["error"]}
        if not pmids:
            return {"skill": "pubmed-database", "results": [], "meta": {"count": 0}}

        pmid_str = ",".join(str(p) for p in pmids[:max_results])
        code2, _, stderr2 = _run_uv(
            PUBMED_SKILL,
            "scripts/pubmed_api.py",
            [str(out_fetch), "fetch_article_abstracts", pmid_str],
        )
        if code2 != 0 or not out_fetch.is_file():
            return {"skill": "pubmed-database", "results": [], "error": stderr2.strip() or f"fetch exit {code2}"}

        articles = json.loads(out_fetch.read_text())
        if isinstance(articles, dict) and "error" in articles:
            return {"skill": "pubmed-database", "results": [], "error": articles["error"]}

        return {"skill": "pubmed-database", "results": articles, "meta": {"count": len(articles)}}


def skills_status() -> dict[str, Any]:
    return {
        "vendor_path": str(SKILLS_VENDOR),
        "openalex": (OPENALEX_SKILL / "scripts" / "openalex_cli.py").is_file(),
        "europepmc": (EUROPEPMC_SKILL / "scripts" / "europepmc_api.py").is_file(),
        "pubmed": (PUBMED_SKILL / "scripts" / "pubmed_api.py").is_file(),
    }
