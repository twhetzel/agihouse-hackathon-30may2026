"""GWAS Catalog Solr + REST v2 client for unified study/publication discovery."""

from __future__ import annotations

import re
from typing import Any

from . import config
from . import http_client
from . import scoring

SOLR_BASE = "https://www.ebi.ac.uk/gwas/api/search"
REST_V2_BASE = "https://www.ebi.ac.uk/gwas/rest/api/v2"


def _get_json(url: str, params: dict[str, str | int] | None = None) -> dict[str, Any]:
    result = http_client.get_json(url, params, cache_ttl=config.CACHE_TTL_CATALOG_SEC)
    if result.get("error"):
        return {"error": result["error"]}
    return result.get("data") or {}


def _author_names_from_solr(doc: dict[str, Any]) -> list[str]:
    names: list[str] = []
    if doc.get("author_s"):
        names.append(str(doc["author_s"]))
    for entry in doc.get("author") or []:
        if entry and entry not in names:
            names.append(str(entry))
    for entry in doc.get("authorsList") or []:
        part = str(entry).split("|")[0].strip()
        if part and part not in names:
            names.append(part)
    return names


def _study_title(doc: dict[str, Any]) -> str:
    return (
        doc.get("title")
        or doc.get("disease_trait")
        or doc.get("reportedTrait")
        or doc.get("reportedTrait_s")
        or ""
    )


def _catalog_status(doc: dict[str, Any]) -> str:
    pmid = doc.get("pmid")
    if pmid:
        return "published"
    if doc.get("fullPvalueSet"):
        return "prepublished"
    return "curated"


def _study_url(doc: dict[str, Any]) -> str | None:
    accession = doc.get("accessionId")
    if accession:
        return f"https://www.ebi.ac.uk/gwas/studies/{accession}"
    pmid = doc.get("pmid")
    if pmid:
        return f"https://www.ebi.ac.uk/gwas/publications/{pmid}"
    return None


def _publication_url(doc: dict[str, Any]) -> str | None:
    pmid = doc.get("pmid")
    if pmid:
        return f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    return None


def escape_solr_query(text: str) -> str:
    """Escape Lucene special characters for GWAS Catalog Solr ``q`` parameter."""
    cleaned = text.strip()
    if not cleaned:
        return cleaned
    return re.sub(r'([+\-&|!(){}[\]^"~*?:\\/])', r"\\\1", cleaned)


def build_search_terms(submission: dict[str, Any]) -> list[str]:
    """Build Solr query strings from submission metadata."""
    title = (submission.get("title") or "").strip()
    trait = (submission.get("reported_trait") or "").strip()
    authors = submission.get("authors") or []
    cohort = (submission.get("cohort") or "").strip()

    queries: list[str] = []
    if title:
        queries.append(title[:160])
    if trait and trait.lower() not in title.lower():
        queries.append(trait[:80])
    if authors:
        last_names = []
        for name in authors[:4]:
            last = scoring.author_last_name(name)
            if last and last.lower() not in {n.lower() for n in last_names}:
                last_names.append(last)
        if last_names:
            queries.append(" ".join(last_names))
    if cohort and len(queries) < 3:
        queries.append(cohort[:60])

    deduped: list[str] = []
    seen: set[str] = set()
    for q in queries:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(q)
    return deduped or ["gwas"]


def search_solr(
    query: str,
    *,
    resource: str | None = None,
    size: int = 10,
) -> dict[str, Any]:
    solr_q = escape_solr_query(query)
    params: dict[str, str | int] = {
        "q": solr_q,
        "rows": size,
        "wt": "json",
        "facet": "false",
    }
    if resource:
        params["fq"] = f"resourcename:{resource}"
    data = _get_json(SOLR_BASE, params)
    if data.get("error"):
        return {"results": [], "error": data["error"], "query": query}
    docs = (data.get("response") or {}).get("docs") or []
    return {
        "results": docs,
        "num_found": (data.get("response") or {}).get("numFound", 0),
        "query": query,
    }


def score_against_submission(
    submission: dict[str, Any],
    *,
    title: str,
    authors: list[str],
    trait: str = "",
    accession: str = "",
    summary_stats_url: str = "",
    identifier_match: str | None = None,
) -> dict[str, Any]:
    sub_title = submission.get("title") or ""
    sub_authors = submission.get("authors") or []
    sub_trait = submission.get("reported_trait") or ""
    sub_file = submission.get("summary_stats_file") or ""

    title_sim = scoring.title_jaccard(sub_title, title)
    author_sim = scoring.author_overlap(sub_authors, authors)
    trait_sim = scoring.title_jaccard(sub_trait, trait) if sub_trait and trait else 0.0

    file_sim = 0.0
    if sub_file:
        candidates = [c for c in (accession, summary_stats_url) if c]
        if candidates:
            file_sim = max(scoring.file_similarity(sub_file, c) for c in candidates)

    parts: list[tuple[float, float]] = []
    if sub_title:
        parts.append((0.40, title_sim))
    if sub_authors:
        parts.append((0.30, author_sim))
    if sub_file and file_sim > 0:
        parts.append((0.15, file_sim))
    if sub_trait and trait:
        parts.append((0.15, trait_sim))

    if parts:
        total_w = sum(w for w, _ in parts)
        combined = sum(w * s for w, s in parts) / total_w
    else:
        combined = scoring.combined_score(title_sim, author_sim)

    if identifier_match in ("gcst_exact", "doi_exact"):
        combined = 1.0

    relationship = scoring.classify_relationship(
        title_sim,
        author_sim,
        identifier_match=identifier_match,
        file_sim=file_sim,
    )
    if relationship == "uncertain" and trait_sim >= 0.35:
        relationship = "related"

    return {
        "title_jaccard": round(title_sim, 4),
        "author_overlap": round(author_sim, 4),
        "trait_overlap": round(trait_sim, 4),
        "file_similarity": round(file_sim, 4),
        "identifier_match": identifier_match,
        "combined_score": round(combined, 4),
        "relationship": relationship,
    }


def _match_signals_payload(signals: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "title_jaccard": signals["title_jaccard"],
        "author_overlap": signals["author_overlap"],
        "trait_overlap": signals["trait_overlap"],
        "file_similarity": signals.get("file_similarity", 0.0),
        "combined_score": signals["combined_score"],
    }
    if signals.get("identifier_match"):
        payload["identifier_match"] = signals["identifier_match"]
    return payload


def enrich_study_from_rest(item: dict[str, Any]) -> dict[str, Any]:
    """Attach sumstats URL and publication status from GWAS Catalog REST v2."""
    acc = item.get("accession_id")
    if not acc:
        return item

    data = _get_json(f"{REST_V2_BASE}/studies/{acc}")
    if data.get("error"):
        return item

    ftp = data.get("full_summary_stats")
    if ftp:
        item["summary_stats_url"] = str(ftp)

    if "full_summary_stats_available" in data:
        item["full_summary_stats"] = bool(data["full_summary_stats_available"])
    elif item.get("full_summary_stats") is None:
        item["full_summary_stats"] = bool(item.get("full_summary_stats"))

    pubmed_id = data.get("pubmed_id")
    if pubmed_id:
        item["pmid"] = str(pubmed_id)
        item["catalog_status"] = "published"
    elif item.get("full_summary_stats") and not item.get("pmid"):
        item["catalog_status"] = "prepublished"

    return item


def normalize_solr_study(
    doc: dict[str, Any],
    submission: dict[str, Any],
    *,
    identifier_match: str | None = None,
    summary_stats_url: str = "",
) -> dict[str, Any]:
    title = _study_title(doc)
    authors = _author_names_from_solr(doc)
    trait = doc.get("reportedTrait") or doc.get("reportedTrait_s") or doc.get("disease_trait") or ""
    accession = doc.get("accessionId") or ""
    signals = score_against_submission(
        submission,
        title=title,
        authors=authors,
        trait=str(trait),
        accession=str(accession),
        summary_stats_url=summary_stats_url,
        identifier_match=identifier_match,
    )
    pmid = doc.get("pmid")
    status = _catalog_status(doc)

    item = {
        "result_type": "catalog_study",
        "catalog_status": status,
        "accession_id": accession,
        "pmid": str(pmid) if pmid else None,
        "title": title,
        "authors": authors,
        "reported_trait": trait or None,
        "efo_traits": doc.get("efoLink") or [],
        "full_summary_stats": bool(doc.get("fullPvalueSet")),
        "match_signals": _match_signals_payload(signals),
        "relationship": signals["relationship"],
        "source": "gwas_catalog_solr",
        "sources": ["gwas_catalog_solr"],
        "url": _study_url(doc),
        "catalog_url": f"https://www.ebi.ac.uk/gwas/studies/{accession}" if accession else None,
    }
    if identifier_match:
        item["sources"] = sorted(set(item["sources"]) | {"identifier_anchor"})
    return item


def normalize_solr_publication(
    doc: dict[str, Any],
    submission: dict[str, Any],
    *,
    identifier_match: str | None = None,
    doi: str | None = None,
) -> dict[str, Any]:
    title = doc.get("title") or ""
    authors = _author_names_from_solr(doc)
    pmid = doc.get("pmid")
    signals = score_against_submission(
        submission,
        title=title,
        authors=authors,
        identifier_match=identifier_match,
    )
    linked_accessions = doc.get("parentDocument_accessionId") or []

    item = {
        "result_type": "catalog_publication",
        "catalog_status": "published",
        "accession_id": linked_accessions[0] if linked_accessions else None,
        "linked_accessions": linked_accessions,
        "pmid": str(pmid) if pmid else None,
        "doi": doi,
        "title": title,
        "authors": authors,
        "year": (doc.get("publicationDate") or "")[:4] or None,
        "journal": doc.get("journal"),
        "study_count": doc.get("studyCount"),
        "match_signals": _match_signals_payload(signals),
        "relationship": signals["relationship"],
        "source": "gwas_catalog_solr",
        "sources": ["gwas_catalog_solr"],
        "url": _publication_url(doc),
        "catalog_url": f"https://www.ebi.ac.uk/gwas/publications/{pmid}" if pmid else None,
    }
    if identifier_match:
        item["sources"] = sorted(set(item["sources"]) | {"identifier_anchor"})
    return item


def _dedupe_catalog_key(item: dict[str, Any]) -> str:
    if item.get("result_type") == "catalog_study" and item.get("accession_id"):
        return f"gcst:{item['accession_id']}"
    if item.get("pmid"):
        return f"pmid:{item['pmid']}"
    return f"title:{(item.get('title') or '').lower()[:120]}"


def search_catalog(submission: dict[str, Any], *, max_per_query: int = 8) -> dict[str, Any]:
    """Search GWAS Catalog Solr for related studies and publications."""
    queries = build_search_terms(submission)
    calls: list[dict[str, Any]] = []
    raw_studies: list[dict] = []
    raw_publications: list[dict] = []

    for query in queries[:3]:
        study_resp = search_solr(query, resource="study", size=max_per_query)
        pub_resp = search_solr(query, resource="publication", size=max_per_query)
        calls.append(
            {
                "query": query,
                "studies_found": study_resp.get("num_found", 0),
                "publications_found": pub_resp.get("num_found", 0),
                "study_error": study_resp.get("error"),
                "publication_error": pub_resp.get("error"),
            }
        )
        raw_studies.extend(study_resp.get("results") or [])
        raw_publications.extend(pub_resp.get("results") or [])

    merged: dict[str, dict[str, Any]] = {}

    for doc in raw_studies:
        if doc.get("resourcename") != "study":
            continue
        item = normalize_solr_study(doc, submission)
        key = _dedupe_catalog_key(item)
        existing = merged.get(key)
        if existing is None or item["match_signals"]["combined_score"] > existing["match_signals"]["combined_score"]:
            merged[key] = item

    for doc in raw_publications:
        if doc.get("resourcename") != "publication":
            continue
        item = normalize_solr_publication(doc, submission)
        key = _dedupe_catalog_key(item)
        existing = merged.get(key)
        if existing is None or item["match_signals"]["combined_score"] > existing["match_signals"]["combined_score"]:
            merged[key] = item

    ranked = sorted(
        merged.values(),
        key=lambda x: x["match_signals"]["combined_score"],
        reverse=True,
    )

    # Drop very weak noise unless we have almost nothing
    if len(ranked) > 5:
        ranked = [r for r in ranked if r["match_signals"]["combined_score"] >= 0.08] or ranked[:5]

    studies = [r for r in ranked if r["result_type"] == "catalog_study"]
    publications = [r for r in ranked if r["result_type"] == "catalog_publication"]
    prepublished = [r for r in studies if r["catalog_status"] == "prepublished"]

    return {
        "related_catalog_results": ranked[:20],
        "related_catalog_studies": studies[:15],
        "related_catalog_publications": publications[:10],
        "prepublished_study_count": len(prepublished),
        "catalog_calls": calls,
        "queries_used": queries,
        "errors": [
            c["study_error"] or c["publication_error"]
            for c in calls
            if c.get("study_error") or c.get("publication_error")
        ],
        "ok": not any(c.get("study_error") or c.get("publication_error") for c in calls),
    }


def lookup_by_accession(
    accession: str,
    submission: dict[str, Any],
    *,
    identifier_match: str = "gcst_exact",
) -> list[dict[str, Any]]:
    """Direct GWAS Catalog lookup when a GCST accession is known."""
    acc = accession.upper()
    resp = search_solr(acc, resource="study", size=5)
    if resp.get("error"):
        return []

    for doc in resp.get("results") or []:
        if (doc.get("accessionId") or "").upper() != acc:
            continue
        item = normalize_solr_study(doc, submission, identifier_match=identifier_match)
        item = enrich_study_from_rest(item)
        if item.get("summary_stats_url"):
            signals = score_against_submission(
                submission,
                title=item.get("title") or "",
                authors=item.get("authors") or [],
                trait=str(item.get("reported_trait") or ""),
                accession=acc,
                summary_stats_url=str(item.get("summary_stats_url") or ""),
                identifier_match=identifier_match,
            )
            item["match_signals"] = _match_signals_payload(signals)
            item["relationship"] = signals["relationship"]
        return [item]
    return []


def lookup_by_doi(doi: str, submission: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve GWAS Catalog publications and linked studies by DOI."""
    normalized = scoring.normalize_doi(doi)
    if not normalized:
        return []

    results: list[dict[str, Any]] = []
    seen_studies: set[str] = set()
    seen_pubs: set[str] = set()

    pub_resp = search_solr(normalized, resource="publication", size=8)
    for doc in pub_resp.get("results") or []:
        pmid = str(doc.get("pmid") or "")
        pub_key = pmid or (doc.get("title") or "")[:80]
        if pub_key in seen_pubs:
            continue
        seen_pubs.add(pub_key)

        pub_item = normalize_solr_publication(
            doc,
            submission,
            identifier_match="doi_exact",
            doi=normalized,
        )
        results.append(pub_item)

        for acc in pub_item.get("linked_accessions") or []:
            acc_upper = str(acc).upper()
            if acc_upper in seen_studies:
                continue
            seen_studies.add(acc_upper)
            results.extend(lookup_by_accession(acc_upper, submission))

    if results:
        return results

    data = _get_json(f"{REST_V2_BASE}/publications", {"doi": normalized, "size": 3})
    pubs = ((data.get("_embedded") or {}).get("publications")) or []
    for pub in pubs:
        pmid = str(pub.get("pubmed_id") or "")
        if pmid in seen_pubs:
            continue
        seen_pubs.add(pmid)

        authors = [a.get("full_name") for a in pub.get("authors") or [] if a.get("full_name")]
        title = pub.get("title") or ""
        signals = score_against_submission(
            submission,
            title=title,
            authors=authors,
            identifier_match="doi_exact",
        )
        results.append({
            "result_type": "catalog_publication",
            "catalog_status": "published",
            "pmid": pmid or None,
            "doi": normalized,
            "title": title,
            "authors": authors,
            "year": (pub.get("publication_date") or "")[:4] or None,
            "journal": pub.get("journal"),
            "match_signals": _match_signals_payload(signals),
            "relationship": signals["relationship"],
            "source": "gwas_catalog_rest",
            "sources": ["gwas_catalog_rest", "identifier_anchor"],
            "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
            "catalog_url": f"https://www.ebi.ac.uk/gwas/publications/{pmid}" if pmid else None,
        })

        if pmid:
            solr_pub = search_solr(pmid, resource="publication", size=3)
            for doc in solr_pub.get("results") or []:
                for acc in doc.get("parentDocument_accessionId") or []:
                    acc_upper = str(acc).upper()
                    if acc_upper in seen_studies:
                        continue
                    seen_studies.add(acc_upper)
                    results.extend(lookup_by_accession(acc_upper, submission))

    return results


def probe_catalog() -> dict[str, Any]:
    return http_client.probe_url(SOLR_BASE, {"q": "asthma", "rows": 1, "wt": "json", "facet": "false"})


def enrich_publication_from_rest(pmid: str) -> dict[str, Any] | None:
    """Fetch publication metadata from GWAS Catalog REST v2."""
    data = _get_json(f"{REST_V2_BASE}/publications", {"pubmed_id": pmid, "size": 1})
    pubs = ((data.get("_embedded") or {}).get("publications")) or []
    if not pubs:
        return None
    pub = pubs[0]
    authors = [a.get("full_name") for a in pub.get("authors") or [] if a.get("full_name")]
    return {
        "pmid": str(pub.get("pubmed_id") or pmid),
        "title": pub.get("title"),
        "journal": pub.get("journal"),
        "publication_date": pub.get("publication_date"),
        "authors": authors,
        "first_author": (pub.get("first_author") or {}).get("full_name"),
        "catalog_url": f"https://www.ebi.ac.uk/gwas/publications/{pmid}",
    }
