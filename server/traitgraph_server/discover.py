"""Unified discovery: GWAS Catalog + literature (Science Skills primary, HTTP fallback)."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from . import config
from . import gwas_catalog
from . import identifiers
from . import literature
from . import literature_search
from . import scoring
from .literature_search import SKILL_NAMES
from .paths import skills_installed


def _openalex_authors(work: dict) -> list[str]:
    names = []
    for auth in work.get("authorships") or []:
        name = (auth.get("author") or {}).get("display_name")
        if name:
            names.append(name)
    return names


def _openalex_url(work: dict) -> str | None:
    wid = work.get("id")
    if wid:
        return wid if wid.startswith("http") else f"https://openalex.org/{wid}"
    return None


def _normalize_literature_hit(
    *,
    source: str,
    title: str,
    authors: list[str],
    submission: dict,
    skill: str | None = None,
    doi: str | None = None,
    pmid: str | None = None,
    url: str | None = None,
    year: str | None = None,
    journal: str | None = None,
    cited_by_count: int | None = None,
    identifier_match: str | None = None,
) -> dict[str, Any]:
    sub_authors = submission.get("authors") or []
    title_sim = scoring.title_jaccard(submission.get("title") or "", title)
    author_sim = scoring.author_overlap(sub_authors, authors)
    trait = submission.get("reported_trait") or ""
    trait_sim = scoring.title_jaccard(trait, title) if trait else 0.0
    combined = scoring.combined_score(title_sim, author_sim)
    if trait_sim >= 0.2:
        combined = max(combined, 0.5 * combined + 0.5 * trait_sim)
    if identifier_match == "doi_exact":
        combined = 1.0

    relationship = scoring.classify_relationship(
        title_sim,
        author_sim,
        identifier_match=identifier_match,
    )

    match_signals: dict[str, Any] = {
        "title_jaccard": round(title_sim, 4),
        "author_overlap": round(author_sim, 4),
        "trait_overlap": round(trait_sim, 4),
        "file_similarity": 0.0,
        "combined_score": round(combined, 4),
    }
    if identifier_match:
        match_signals["identifier_match"] = identifier_match

    sources = [source]
    if identifier_match:
        sources.append("identifier_anchor")

    return {
        "result_type": "literature",
        "catalog_status": None,
        "title": title,
        "authors": authors,
        "year": year,
        "doi": doi,
        "pmid": pmid,
        "url": url,
        "journal": journal,
        "cited_by_count": cited_by_count,
        "match_signals": match_signals,
        "relationship": relationship,
        "source": source,
        "skill": skill or SKILL_NAMES.get(source, source),
        "sources": sources,
    }


def _normalize_openalex_hit(work: dict, submission: dict) -> dict[str, Any]:
    title = work.get("display_name") or work.get("title") or ""
    return _normalize_literature_hit(
        source="openalex",
        skill="literature-search-openalex",
        title=title,
        authors=_openalex_authors(work),
        submission=submission,
        doi=scoring.normalize_doi(work.get("doi") or (work.get("ids") or {}).get("doi")),
        url=_openalex_url(work),
        year=str(work.get("publication_year")) if work.get("publication_year") else None,
        cited_by_count=work.get("cited_by_count"),
    )


def _normalize_europepmc_hit(hit: dict, submission: dict) -> dict[str, Any]:
    title = hit.get("title") or ""
    author_str = hit.get("authorString") or ""
    authors = [a.strip() for a in author_str.replace(";", ",").split(",") if a.strip()]
    pmid = hit.get("pmid")
    pmcid = hit.get("pmcid")
    url = None
    if pmid:
        url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    elif pmcid:
        url = f"https://europepmc.org/article/MED/{pmcid}"
    return _normalize_literature_hit(
        source="europepmc",
        skill="literature-search-europepmc",
        title=title,
        authors=authors,
        submission=submission,
        doi=scoring.normalize_doi(hit.get("doi")),
        pmid=str(pmid) if pmid else None,
        url=url,
        year=str(hit.get("pubYear")) if hit.get("pubYear") else None,
        journal=hit.get("journalTitle"),
    )


def _normalize_pubmed_hit(article: dict, submission: dict) -> dict[str, Any]:
    title = article.get("title") or ""
    authors = article.get("authors") or []
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(",") if a.strip()]
    pmid = article.get("pmid")
    return _normalize_literature_hit(
        source="pubmed",
        skill="pubmed-database",
        title=title,
        authors=authors,
        submission=submission,
        doi=scoring.normalize_doi(article.get("doi")),
        pmid=str(pmid) if pmid else None,
        url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
        year=str(article.get("year") or "")[:4] or None,
        journal=article.get("journal"),
    )


def _hits_from_doi_lookup(doi: str, submission: dict) -> list[dict]:
    """Convert DOI anchor literature hits into normalized result items."""
    lookup = literature.lookup_by_doi(doi)
    hits: list[dict] = []
    normalized_doi = lookup.get("doi") or scoring.normalize_doi(doi)

    work = lookup.get("results", {}).get("openalex")
    if work:
        hits.append(
            _normalize_literature_hit(
                source="openalex",
                skill="literature-search-openalex",
                title=work.get("display_name") or work.get("title") or "",
                authors=_openalex_authors(work),
                submission=submission,
                doi=scoring.normalize_doi(work.get("doi") or (work.get("ids") or {}).get("doi")) or normalized_doi,
                url=_openalex_url(work),
                year=str(work.get("publication_year")) if work.get("publication_year") else None,
                cited_by_count=work.get("cited_by_count"),
                identifier_match="doi_exact",
            )
        )

    epmc = lookup.get("results", {}).get("europepmc")
    if epmc:
        hits.append(_normalize_europepmc_hit(epmc, submission))
        hits[-1]["match_signals"]["identifier_match"] = "doi_exact"
        hits[-1]["match_signals"]["combined_score"] = 1.0
        hits[-1]["relationship"] = "likely_same_study"
        hits[-1]["sources"] = sorted(set(hits[-1].get("sources") or []) | {"identifier_anchor"})

    pubmed = lookup.get("results", {}).get("pubmed")
    if pubmed:
        hits.append(_normalize_pubmed_hit(pubmed, submission))
        hits[-1]["match_signals"]["identifier_match"] = "doi_exact"
        hits[-1]["match_signals"]["combined_score"] = 1.0
        hits[-1]["relationship"] = "likely_same_study"
        hits[-1]["sources"] = sorted(set(hits[-1].get("sources") or []) | {"identifier_anchor"})

    merged: dict[str, dict] = {}
    for hit in hits:
        _merge_item(merged, hit)
    return list(merged.values())


def _dedupe_key(item: dict[str, Any]) -> str:
    if item.get("result_type") == "catalog_study" and item.get("accession_id"):
        return f"gcst:{item['accession_id']}"
    pmid = item.get("pmid")
    if pmid:
        return f"pmid:{pmid}"
    doi = item.get("doi")
    if doi:
        return f"doi:{doi}"
    return f"title:{(item.get('title') or '').lower()[:120]}"


def _record_priority(item: dict[str, Any]) -> int:
    """Higher = preferred canonical record when match scores tie."""
    result_type = item.get("result_type")
    if result_type == "literature":
        return 40
    if result_type == "catalog_study":
        if item.get("catalog_status") == "prepublished":
            return 35
        id_match = (item.get("match_signals") or {}).get("identifier_match")
        if id_match == "gcst_exact":
            return 38
        return 30
    if result_type == "catalog_publication":
        return 10
    return 0


_CATALOG_ENRICHMENT_FIELDS = (
    "accession_id",
    "linked_accessions",
    "catalog_url",
    "catalog_status",
    "study_count",
    "full_summary_stats",
    "summary_stats_url",
    "reported_trait",
    "efo_traits",
)


def _merge_sources(result: dict[str, Any], *items: dict[str, Any]) -> None:
    sources: set[str] = set()
    for item in items:
        sources.update(item.get("sources") or [])
        if item.get("source"):
            sources.add(item["source"])
    result["sources"] = sorted(s for s in sources if s)


def _enrich_catalog_metadata(target: dict[str, Any], source: dict[str, Any]) -> None:
    if source.get("result_type") not in ("catalog_study", "catalog_publication"):
        return
    for field in _CATALOG_ENRICHMENT_FIELDS:
        if source.get(field) is not None and target.get(field) in (None, "", []):
            target[field] = source[field]
    target["gwas_catalog_linked"] = True


def _pick_winner(a: dict[str, Any], b: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    score_a = a["match_signals"]["combined_score"]
    score_b = b["match_signals"]["combined_score"]
    if score_b > score_a + 1e-9:
        return b, a
    if score_a > score_b + 1e-9:
        return a, b

    id_a = a["match_signals"].get("identifier_match")
    id_b = b["match_signals"].get("identifier_match")
    if id_b and not id_a:
        return b, a
    if id_a and not id_b:
        return a, b

    if _record_priority(b) > _record_priority(a):
        return b, a
    return a, b


def _combine_records(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Merge duplicate hits; literature is canonical for shared PMID/DOI paper matches."""
    lit = a if a.get("result_type") == "literature" else b if b.get("result_type") == "literature" else None
    cat_pub = (
        a if a.get("result_type") == "catalog_publication"
        else b if b.get("result_type") == "catalog_publication"
        else None
    )

    if lit and cat_pub:
        winner, _loser = _pick_winner(lit, cat_pub)
        result = dict(lit)
        result["match_signals"] = dict(winner["match_signals"])
        result["relationship"] = winner.get("relationship", lit.get("relationship"))
        for field in ("doi", "pmid", "url", "year", "journal", "authors", "title", "skill", "source"):
            if not result.get(field) and cat_pub.get(field):
                result[field] = cat_pub[field]
        _enrich_catalog_metadata(result, cat_pub)
        _merge_sources(result, a, b)
        return result

    winner, loser = _pick_winner(a, b)
    result = dict(winner)
    _enrich_catalog_metadata(result, loser)
    _merge_sources(result, a, b)
    return result


def _merge_item(merged: dict[str, dict], item: dict[str, Any]) -> None:
    key = _dedupe_key(item)
    existing = merged.get(key)
    if existing is None:
        merged[key] = item
        return
    merged[key] = _combine_records(existing, item)


def _hits_from_literature_raw(raw: dict[str, dict], submission: dict) -> list[dict]:
    raw_hits: list[dict] = []
    for w in raw.get("openalex", {}).get("results") or []:
        raw_hits.append(_normalize_openalex_hit(w, submission))
    for h in raw.get("europepmc", {}).get("results") or []:
        raw_hits.append(_normalize_europepmc_hit(h, submission))
    for a in raw.get("pubmed", {}).get("results") or []:
        raw_hits.append(_normalize_pubmed_hit(a, submission))
    lit_merged: dict[str, dict] = {}
    for hit in raw_hits:
        _merge_item(lit_merged, hit)
    return list(lit_merged.values())


def _run_literature_search(
    submission: dict[str, Any],
) -> tuple[list[dict], dict[str, Any], list[str], dict[str, Any]]:
    raw, meta = literature_search.run_literature_search(submission)
    hits = _hits_from_literature_raw(raw, submission)
    return hits, meta.get("calls", {}), meta.get("failed", []), meta


def _score_clause(top: dict[str, Any]) -> str:
    signals = top["match_signals"]
    return (
        f"(score {signals['combined_score']:.0%}, "
        f"title {signals['title_jaccard']:.0%}, "
        f"authors {signals['author_overlap']:.0%})"
    )


def _catalog_context_suffix(top: dict[str, Any]) -> str:
    if top.get("accession_id") and (
        top.get("gwas_catalog_linked")
        or top.get("result_type") in ("literature", "catalog_publication")
    ):
        return f" Also indexed in GWAS Catalog as {top['accession_id']}."
    return ""


def _published_paper_title(top: dict[str, Any]) -> str:
    title = (top.get("title") or "").strip()
    return title or "this paper"


def _search_context_summary(
    ranked: list[dict[str, Any]],
    *,
    studies: list[dict[str, Any]],
    pubs: list[dict[str, Any]],
    prepub: list[dict[str, Any]],
    relationship: str,
) -> str | None:
    total = len(ranked)
    if total <= 1:
        return None

    study_n = len(studies)
    pub_n = len(pubs)
    prepub_n = len(prepub)
    parts = [f"{total} candidates"]
    detail_parts = []
    if study_n:
        detail_parts.append(f"{study_n} Catalog {'study' if study_n == 1 else 'studies'}")
    if pub_n:
        detail_parts.append(f"{pub_n} publication{'s' if pub_n != 1 else ''}")
    if prepub_n:
        detail_parts.append(f"{prepub_n} pre-pub sumstats")
    if detail_parts:
        parts.append(f"({', '.join(detail_parts)})")

    prefix = " ".join(parts)
    if relationship == "likely_same_study":
        return (
            f"{prefix} from the broader search. Only the top match is assessed as likely the same study; "
            "the counts below are related hits, not additional same-study confirmations."
        )
    if relationship == "related":
        return f"{prefix} from the broader search. Review the ranked list below."
    return f"{prefix} from the broader search."


def _build_summary(
    ranked: list[dict[str, Any]],
    catalog_bundle: dict[str, Any],
    *,
    degraded_sources: list[str],
) -> dict[str, Any]:
    studies = [r for r in ranked if r.get("result_type") == "catalog_study"]
    pubs = [r for r in ranked if r.get("result_type") in ("catalog_publication", "literature")]
    prepub = [r for r in studies if r.get("catalog_status") == "prepublished"]
    published_studies = [r for r in studies if r.get("catalog_status") == "published"]

    top = ranked[0] if ranked else None
    if top:
        rel = top.get("relationship", "uncertain")
        conf = top["match_signals"]["combined_score"]
        id_match = (top.get("match_signals") or {}).get("identifier_match")
        result_type = top.get("result_type")

        if rel == "likely_same_study":
            if id_match == "gcst_exact" and result_type == "catalog_study" and top.get("accession_id"):
                explanation = (
                    f"Top match resolved by GCST accession {top['accession_id']} "
                    f"in GWAS Catalog {_score_clause(top)}."
                )
            elif result_type == "catalog_study" and top.get("catalog_status") == "prepublished":
                explanation = (
                    f"Top match is a pre-publication sumstats entry in GWAS Catalog "
                    f"({_published_paper_title(top)}) {_score_clause(top)}."
                )
            elif id_match == "doi_exact":
                explanation = (
                    f"Likely match to a published paper resolved by DOI "
                    f"{_score_clause(top)}.{_catalog_context_suffix(top)}"
                )
            elif result_type in ("literature", "catalog_publication") or top.get("pmid"):
                explanation = (
                    f"Likely match to a published paper {_score_clause(top)}."
                    f"{_catalog_context_suffix(top)}"
                )
            elif result_type == "catalog_study":
                explanation = (
                    f"Top match is a GWAS Catalog study "
                    f"({_published_paper_title(top)}) {_score_clause(top)}."
                )
            else:
                explanation = f"Likely match {_score_clause(top)}."
        elif rel == "related":
            explanation = (
                f"Found {len(ranked)} related studies and publications across literature "
                f"and GWAS Catalog (top score {conf:.0%})."
            )
        else:
            explanation = (
                f"Found {len(ranked)} candidates; matches are weak — review trait and author overlap."
            )
    else:
        rel = "no_match"
        conf = 0.0
        explanation = "No related studies or publications found in literature or GWAS Catalog."

    if degraded_sources:
        explanation += f" Warning: some sources unavailable ({', '.join(degraded_sources)})."

    search_context = None
    if top:
        search_context = _search_context_summary(
            ranked,
            studies=studies,
            pubs=pubs,
            prepub=prepub,
            relationship=rel if top else "no_match",
        )

    return {
        "confidence": round(conf, 4),
        "relationship": rel if top else "no_match",
        "explanation": explanation,
        "search_context": search_context,
        "top_match": top,
        "total_results": len(ranked),
        "catalog_study_count": len(studies),
        "published_study_count": len(published_studies),
        "prepublished_study_count": len(prepub),
        "publication_count": len(pubs),
        "results_returned": min(len(ranked), 25),
        "catalog_queries": catalog_bundle.get("queries_used", []),
        "degraded_sources": degraded_sources,
    }


def discover(submission: dict[str, Any]) -> dict[str, Any]:
    """Unified discovery across GWAS Catalog and literature sources."""
    if not identifiers.has_discovery_input(submission):
        raise ValueError(
            "title, reported_trait, doi, or GCST accession is required for discovery"
        )

    ids = identifiers.collect_identifiers(submission)
    effective_submission = submission
    if ids["doi"] and (
        not (submission.get("title") or "").strip() or not (submission.get("authors") or [])
    ):
        effective_submission = literature.bootstrap_submission_from_doi(submission, ids["doi"])

    run_id = str(uuid.uuid4())
    degraded: list[str] = []
    anchor_sources: list[str] = []
    anchor_hits: list[dict] = []

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures: dict[Any, str] = {
            pool.submit(gwas_catalog.search_catalog, effective_submission): "catalog",
            pool.submit(_run_literature_search, effective_submission): "lit",
        }
        if ids["gcst"]:
            futures[pool.submit(gwas_catalog.lookup_by_accession, ids["gcst"], submission)] = "gcst"
        if ids["doi"]:
            futures[pool.submit(gwas_catalog.lookup_by_doi, ids["doi"], submission)] = "doi_catalog"
            futures[pool.submit(_hits_from_doi_lookup, ids["doi"], submission)] = "doi_lit"

        catalog_bundle = None
        literature_hits: list[dict] = []
        lit_calls: dict[str, Any] = {}
        lit_failed: list[str] = []
        lit_meta: dict[str, Any] = {}

        for future, key in futures.items():
            result = future.result()
            if key == "catalog":
                catalog_bundle = result
            elif key == "lit":
                literature_hits, lit_calls, lit_failed, lit_meta = result
            elif key == "gcst":
                anchor_hits.extend(result)
                if result:
                    anchor_sources.append("gwas_catalog_accession")
            elif key == "doi_catalog":
                anchor_hits.extend(result)
                if result:
                    anchor_sources.append("gwas_catalog_doi")
            elif key == "doi_lit":
                anchor_hits.extend(result)
                if result:
                    anchor_sources.append("literature_doi")

    if catalog_bundle is None:
        catalog_bundle = {"ok": False, "related_catalog_results": [], "queries_used": []}

    if not catalog_bundle.get("ok", True):
        degraded.append("gwas_catalog_solr")
    degraded.extend(lit_failed)

    merged: dict[str, dict] = {}
    for item in anchor_hits:
        _merge_item(merged, item)
    for item in literature_hits:
        _merge_item(merged, item)
    for item in catalog_bundle.get("related_catalog_results") or []:
        _merge_item(merged, item)

    ranked = sorted(
        merged.values(),
        key=lambda x: (x["match_signals"]["combined_score"], _record_priority(x)),
        reverse=True,
    )
    for i, item in enumerate(ranked, start=1):
        item["rank"] = i
        if "sources" not in item:
            item["sources"] = [item.get("source", "unknown")]

    summary = _build_summary(ranked, catalog_bundle, degraded_sources=sorted(set(degraded)))

    publication_results = [
        r for r in ranked
        if r.get("result_type") in ("literature", "catalog_publication")
    ][:30]
    catalog_study_results = [
        r for r in ranked if r.get("result_type") == "catalog_study"
    ][:30]

    return {
        "schema_version": config.SCHEMA_VERSION,
        "submission": submission,
        "identifier_resolution": {
            "gcst_extracted": ids["gcst"],
            "doi_normalized": ids["doi"],
            "anchor_hit_count": len(anchor_hits),
            "anchor_sources": sorted(set(anchor_sources)),
        },
        "related_results": ranked[:25],
        "publication_results": publication_results,
        "catalog_study_results": catalog_study_results,
        "related_catalog_studies": catalog_bundle.get("related_catalog_studies", [])[:15],
        "related_catalog_publications": catalog_bundle.get("related_catalog_publications", [])[:10],
        "related_publications": publication_results,
        "discovery_summary": summary,
        "same_study_assessment": {
            "confidence": summary["confidence"],
            "relationship": summary["relationship"],
            "explanation": summary["explanation"],
            "top_match": summary["top_match"],
        },
        "source_status": {
            "gwas_catalog_solr": "ok" if catalog_bundle.get("ok", True) else "degraded",
            "openalex": "degraded" if "openalex" in degraded else "ok",
            "europepmc": "degraded" if "europepmc" in degraded else "ok",
            "pubmed": "degraded" if "pubmed" in degraded else "ok",
            "degraded_sources": sorted(set(degraded)),
        },
        "gwas_catalog_provenance": {
            "source": "gwas_catalog_solr",
            "catalog_calls": catalog_bundle.get("catalog_calls", []),
            "queries_used": catalog_bundle.get("queries_used", []),
            "prepublished_study_count": catalog_bundle.get("prepublished_study_count", 0),
            "errors": catalog_bundle.get("errors", []),
        },
        "literature_provenance": {
            "backend": lit_meta.get("backend", "direct_http"),
            "prefer_skills": lit_meta.get("prefer_skills", False),
            "fallback_sources": lit_meta.get("fallback_sources", []),
            "calls": lit_calls,
        },
        "skill_provenance": {
            "skills_used": [
                "gwas-catalog-solr",
                "literature-search-openalex",
                "literature-search-europepmc",
                "pubmed-database",
            ],
            "skill_calls": lit_calls,
            "skills_installed": skills_installed(),
            "literature_backend": lit_meta.get("backend", "direct_http"),
        },
        "provenance": {
            "tool_name": "GWAS PrePubMatch",
            "tool_version": config.API_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "run_id": run_id,
        },
    }


discover_literature = discover
