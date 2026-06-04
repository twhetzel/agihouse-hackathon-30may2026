"""FastAPI entrypoint for GWAS PrePubMatch unified discovery."""

from __future__ import annotations

from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from . import gwas_catalog
from . import literature
from .discover import discover
from .identifiers import has_discovery_input
from .paths import skills_installed
from .skill_runner import skills_status

app = FastAPI(
    title="GWAS PrePubMatch Discovery API",
    description=(
        "Unified discovery across GWAS Catalog (published + pre-published sumstats) "
        "and literature (Google Science Skills primary, direct HTTP fallback)"
    ),
    version=config.API_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SubmissionMetadata(BaseModel):
    source_type: str = "prepublication_summary_statistics_metadata"
    title: str = ""
    authors: list[str] = Field(default_factory=list)
    reported_trait: str = ""
    doi: str = ""
    preprint_or_submission_id: str = ""
    summary_stats_file: str = ""
    cohort: str = ""
    notes: str = ""


def _overall_status(sources: dict[str, Any]) -> str:
    if all(s.get("status") == "ok" for s in sources.values()):
        return "ok"
    if any(s.get("status") == "ok" for s in sources.values()):
        return "degraded"
    return "error"


@app.get("/api/health")
def health() -> dict[str, Any]:
    catalog_probe = gwas_catalog.probe_catalog()
    lit_probes = literature.probe_sources()
    sources = {
        "gwas_catalog_solr": catalog_probe,
        **lit_probes,
    }
    skills_ok = skills_installed()
    if skills_ok:
        literature_backend = "science_skills"
        literature_note = "Per-source direct HTTP fallback when a skill call fails"
    else:
        literature_backend = "direct_http"
        literature_note = "Run scripts/setup_science_skills.sh for Science Skills primary path"
    return {
        "status": _overall_status(sources),
        "version": config.API_VERSION,
        "schema_version": config.SCHEMA_VERSION,
        "cache_enabled": config.CACHE_ENABLED,
        "literature_backend_preferred": "science_skills",
        "literature_backend": literature_backend,
        "literature_backend_note": literature_note,
        "science_skills_installed": skills_ok,
        "sources": sources,
        "skills": skills_status(),
    }


@app.post("/api/discover")
def discover_endpoint(submission: SubmissionMetadata) -> dict[str, Any]:
    payload = submission.model_dump()
    if not has_discovery_input(payload):
        raise HTTPException(
            status_code=400,
            detail="title, reported_trait, doi, or GCST accession is required for discovery",
        )
    try:
        return discover(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def run() -> None:
    kwargs: dict[str, Any] = {
        "host": config.HOST,
        "port": config.PORT,
        "reload": config.WORKERS == 1,
    }
    if config.WORKERS > 1:
        kwargs["workers"] = config.WORKERS
    uvicorn.run("gwas_prepubmatch_server.main:app", **kwargs)


if __name__ == "__main__":
    run()
