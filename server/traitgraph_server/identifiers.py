"""Extract submission identifiers (GCST, DOI) for anchor-based discovery."""

from __future__ import annotations

from typing import Any

from . import scoring


def collect_identifiers(submission: dict[str, Any]) -> dict[str, str | None]:
    """Normalize GCST and DOI from explicit fields and fallbacks."""
    doi = scoring.extract_doi(submission.get("doi"))
    if not doi:
        doi = scoring.extract_doi(submission.get("preprint_or_submission_id"))

    gcst = scoring.extract_gcst(
        submission.get("summary_stats_file"),
        submission.get("preprint_or_submission_id"),
    )

    return {"doi": doi, "gcst": gcst}


def has_discovery_input(submission: dict[str, Any]) -> bool:
    """True when fuzzy or anchor discovery can run."""
    ids = collect_identifiers(submission)
    return bool(
        (submission.get("title") or "").strip()
        or (submission.get("reported_trait") or "").strip()
        or ids["doi"]
        or ids["gcst"]
    )
