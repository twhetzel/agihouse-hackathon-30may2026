"""Deterministic title/author/identifier matching for discovery."""

from __future__ import annotations

import re
from typing import Iterable

STOPWORDS = {
    "of", "in", "and", "the", "analysis", "study", "genome-wide",
    "association", "gwas", "a", "for", "to", "with", "by", "on",
    "at", "from", "cohort", "cohorts", "populations",
}

FILE_IGNORE = {"sumstats", "summary", "statistics", "data", "file", "gwas"}

GCST_RE = re.compile(r"GCST\d+", re.I)
DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s]+)", re.I)


def clean_tokens(text: str) -> set[str]:
    if not text:
        return set()
    words = re.findall(r"\b\w+\b", text.lower())
    return {w for w in words if w not in STOPWORDS}


def normalize_author(name: str) -> str:
    if not name:
        return ""
    return re.sub(r"[^a-zA-Z0-9]", "", name).lower()


def author_last_name(name: str) -> str | None:
    """Extract surname from common author string formats (Last F., Last, First, First Last)."""
    cleaned = (name or "").strip().rstrip(".")
    if not cleaned:
        return None
    if "," in cleaned:
        return cleaned.split(",", 1)[0].strip() or None
    parts = [p.rstrip(".") for p in re.split(r"\s+", cleaned) if p]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    # "Pividori M" / "Nicolae D L" — trailing token is an initial
    if len(parts[-1]) <= 2:
        return parts[0]
    return parts[-1]


def title_jaccard(a: str, b: str) -> float:
    t1, t2 = clean_tokens(a), clean_tokens(b)
    if not t1 or not t2:
        return 0.0
    intersect = len(t1 & t2)
    union = len(t1 | t2)
    return intersect / union if union else 0.0


def author_overlap(submission_authors: Iterable[str], paper_authors: Iterable[str]) -> float:
    prepub = [normalize_author(a) for a in submission_authors if a]
    catalog = [normalize_author(a) for a in paper_authors if a]
    if not prepub or not catalog:
        return 0.0
    norm_prepub = set(prepub)
    norm_catalog = set(catalog)
    if not norm_prepub:
        return 0.0
    matched = sum(1 for a in norm_prepub if a in norm_catalog)
    return matched / len(norm_prepub)


def file_similarity(file_a: str, file_b: str) -> float:
    """Compare summary-stats filenames or paths (GCST in name → exact when matched)."""
    if not file_a or not file_b:
        return 0.0

    a = file_a.lower().strip()
    b = file_b.lower().strip()
    if a == b:
        return 1.0

    gcst_a = extract_gcst(a)
    gcst_b = extract_gcst(b)
    if gcst_a and gcst_b and gcst_a == gcst_b:
        return 1.0
    if gcst_a and gcst_a in b:
        return 1.0
    if gcst_b and gcst_b in a:
        return 1.0

    base_a = re.sub(r"(\.tsv|\.csv|\.gz|\.txt)+$", "", a)
    base_b = re.sub(r"(\.tsv|\.csv|\.gz|\.txt)+$", "", b)
    tokens_a = set(re.findall(r"\b\w+\b", base_a)) - FILE_IGNORE - STOPWORDS
    tokens_b = set(re.findall(r"\b\w+\b", base_b)) - FILE_IGNORE - STOPWORDS
    if not tokens_a or not tokens_b:
        return 0.0
    if tokens_a & tokens_b:
        return 0.5
    return 0.0


def combined_score(title_sim: float, author_sim: float) -> float:
    return 0.6 * title_sim + 0.4 * author_sim


def classify_relationship(
    title_sim: float,
    author_sim: float,
    *,
    identifier_match: str | None = None,
    file_sim: float = 0.0,
) -> str:
    if identifier_match in ("gcst_exact", "doi_exact"):
        return "likely_same_study"
    if file_sim >= 1.0:
        return "likely_same_study"
    if title_sim >= 0.45 and author_sim >= 0.25:
        return "likely_same_study"
    if file_sim >= 0.5 and (title_sim >= 0.25 or author_sim >= 0.2):
        return "related"
    if title_sim >= 0.25 or (title_sim >= 0.15 and author_sim >= 0.2):
        return "related"
    return "uncertain"


def normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    d = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if d.startswith(prefix):
            d = d[len(prefix) :]
            break
    d = d.rstrip(".,;)")
    return d or None


def extract_doi(*texts: str | None) -> str | None:
    for text in texts:
        if not text:
            continue
        normalized = normalize_doi(text)
        if normalized and normalized.startswith("10."):
            return normalized
        match = DOI_RE.search(text)
        if match:
            return normalize_doi(match.group(1))
    return None


def extract_gcst(*texts: str | None) -> str | None:
    for text in texts:
        if not text:
            continue
        match = GCST_RE.search(text)
        if match:
            return match.group(0).upper()
    return None
