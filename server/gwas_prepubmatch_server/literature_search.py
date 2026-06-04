"""Dual-path literature search: Google Science Skills (primary) + direct HTTP (fallback)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from . import literature
from . import skill_runner
from .paths import skills_installed

SKILL_NAMES = {
    "openalex": "literature-search-openalex",
    "europepmc": "literature-search-europepmc",
    "pubmed": "pubmed-database",
}


def _call_summary(result: dict[str, Any], *, backend: str, fallback: bool) -> dict[str, Any]:
    return {
        "skill": result.get("skill") or SKILL_NAMES.get(result.get("source", ""), result.get("source")),
        "source": result.get("source") or result.get("skill", "").replace("literature-search-", ""),
        "backend": backend,
        "fallback": fallback,
        "hit_count": len(result.get("results") or []),
        "error": result.get("error"),
        "cached": result.get("cached", False),
    }


def _search_openalex_skills(title: str) -> dict[str, Any]:
    return skill_runner.search_openalex(title)


def _search_europepmc_skills(title: str) -> dict[str, Any]:
    return skill_runner.search_europepmc(title)


def _search_pubmed_skills(title: str, trait: str) -> dict[str, Any]:
    return skill_runner.search_pubmed(title, trait)


def _search_one(
    key: str,
    search_title: str,
    trait: str,
    *,
    prefer_skills: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (raw result dict, call summary). Uses HTTP fallback per source on skill failure."""
    skill_fn: Callable[..., dict[str, Any]]
    http_fn: Callable[..., dict[str, Any]]

    if key == "openalex":
        skill_fn = _search_openalex_skills
        http_fn = literature.search_openalex
        http_args: tuple = (search_title,)
    elif key == "europepmc":
        skill_fn = _search_europepmc_skills
        http_fn = literature.search_europepmc
        http_args = (search_title,)
    elif key == "pubmed":
        skill_fn = _search_pubmed_skills
        http_fn = literature.search_pubmed
        http_args = (search_title, trait)
    else:
        raise ValueError(f"unknown literature source: {key}")

    if prefer_skills:
        skill_result = skill_fn(*http_args) if key != "pubmed" else skill_fn(search_title, trait)
        if not skill_result.get("error"):
            return skill_result, _call_summary(skill_result, backend="science_skills", fallback=False)

        http_result = http_fn(*http_args)
        summary = _call_summary(http_result, backend="direct_http", fallback=True)
        summary["skill_error"] = skill_result.get("error")
        return http_result, summary

    http_result = http_fn(*http_args)
    return http_result, _call_summary(http_result, backend="direct_http", fallback=False)


def run_literature_search(
    submission: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """
    Search OpenAlex, Europe PMC, and PubMed.

    Returns:
        raw: keyed by openalex/europepmc/pubmed → result dict with ``results`` list
        meta: backend summary, per-source calls, failed sources
    """
    title = (submission.get("title") or "").strip()
    trait = (submission.get("reported_trait") or "").strip()
    if not title and not trait:
        return {}, {
            "backend": "none",
            "prefer_skills": skills_installed(),
            "calls": {},
            "failed": [],
            "fallback_sources": [],
        }

    search_title = title or trait
    prefer_skills = skills_installed()
    calls: dict[str, dict[str, Any]] = {}
    raw: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    fallback_sources: list[str] = []

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(_search_one, key, search_title, trait, prefer_skills=prefer_skills): key
            for key in ("openalex", "europepmc", "pubmed")
        }
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                result, summary = fut.result()
            except Exception as exc:  # noqa: BLE001
                result = {"source": key, "results": [], "error": str(exc)}
                summary = _call_summary(result, backend="direct_http", fallback=prefer_skills)
                summary["skill_error"] = str(exc)
            calls[key] = summary
            raw[key] = result
            if summary.get("error") or result.get("error"):
                failed.append(key)
            if summary.get("fallback"):
                fallback_sources.append(key)

    backends = {c.get("backend") for c in calls.values()}
    if prefer_skills and "direct_http" not in backends:
        overall_backend = "science_skills"
    elif prefer_skills and fallback_sources:
        overall_backend = "science_skills_with_http_fallback"
    elif prefer_skills:
        overall_backend = "science_skills"
    else:
        overall_backend = "direct_http"

    return raw, {
        "backend": overall_backend,
        "prefer_skills": prefer_skills,
        "skills_installed": prefer_skills,
        "calls": calls,
        "failed": failed,
        "fallback_sources": fallback_sources,
    }
