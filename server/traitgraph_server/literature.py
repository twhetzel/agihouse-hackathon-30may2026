"""Direct HTTP literature search (OpenAlex, Europe PMC, PubMed)."""

from __future__ import annotations

import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from . import config
from . import http_client
from . import scoring

OPENALEX_BASE = "https://api.openalex.org/works"
EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
NCBI_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"


def _openalex_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if config.OPENALEX_API_KEY:
        headers["Authorization"] = f"Bearer {config.OPENALEX_API_KEY}"
    return headers


def _ncbi_params(extra: dict[str, str | int]) -> dict[str, str | int]:
    params = dict(extra)
    if config.NCBI_API_KEY:
        params["api_key"] = config.NCBI_API_KEY
    return params


def lookup_by_doi(doi: str) -> dict[str, Any]:
    """Resolve a DOI via OpenAlex, Europe PMC, and PubMed (first hit per source)."""
    normalized = scoring.normalize_doi(doi)
    if not normalized:
        return {"doi": None, "results": [], "errors": ["invalid doi"]}

    results: dict[str, Any] = {}
    errors: list[str] = []

    oa_params: dict[str, str | int] = {}
    if config.OPENALEX_MAILTO:
        oa_params["mailto"] = config.OPENALEX_MAILTO
    oa_resp = http_client.get_json(
        f"https://api.openalex.org/works/https://doi.org/{urllib.parse.quote(normalized)}",
        oa_params,
        headers=_openalex_headers(),
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if oa_resp.get("error"):
        errors.append(f"openalex: {oa_resp['error']}")
    elif oa_resp.get("data") and oa_resp["data"].get("id"):
        results["openalex"] = oa_resp["data"]

    epmc_resp = http_client.get_json(
        EUROPEPMC_BASE,
        {
            "query": f'DOI:"{normalized}"',
            "format": "json",
            "pageSize": 3,
            "resultType": "core",
        },
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if epmc_resp.get("error"):
        errors.append(f"europepmc: {epmc_resp['error']}")
    else:
        epmc_hits = (epmc_resp.get("data", {}).get("resultList") or {}).get("result") or []
        if epmc_hits:
            results["europepmc"] = epmc_hits[0]

    pubmed_resp = http_client.get_json(
        NCBI_ESEARCH,
        _ncbi_params(
            {
                "db": "pubmed",
                "term": f'"{normalized}"[doi]',
                "retmax": 1,
                "retmode": "json",
            }
        ),
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if pubmed_resp.get("error"):
        errors.append(f"pubmed: {pubmed_resp['error']}")
    else:
        pmids = (pubmed_resp.get("data", {}).get("esearchresult") or {}).get("idlist") or []
        if pmids:
            fetch_url = (
                f"{NCBI_EFETCH}?"
                + urllib.parse.urlencode(
                    _ncbi_params({"db": "pubmed", "id": pmids[0], "retmode": "xml"})
                )
            )
            try:
                req = urllib.request.Request(fetch_url, headers=http_client.build_headers())
                with urllib.request.urlopen(req, timeout=config.HTTP_TIMEOUT_SEC) as resp:
                    xml_text = resp.read().decode("utf-8")
                articles = _parse_pubmed_xml(xml_text)
                if articles:
                    results["pubmed"] = articles[0]
            except Exception as exc:  # noqa: BLE001
                errors.append(f"pubmed_fetch: {exc}")

    return {"doi": normalized, "results": results, "errors": errors}


def bootstrap_submission_from_doi(submission: dict[str, Any], doi: str) -> dict[str, Any]:
    """Fill missing title/authors from a DOI lookup for fuzzy search."""
    if (submission.get("title") or "").strip() and (submission.get("authors") or []):
        return submission

    lookup = lookup_by_doi(doi)
    bootstrapped = dict(submission)

    work = lookup.get("results", {}).get("openalex")
    if work:
        if not (bootstrapped.get("title") or "").strip():
            bootstrapped["title"] = work.get("display_name") or work.get("title") or ""
        if not bootstrapped.get("authors"):
            authors = []
            for auth in work.get("authorships") or []:
                name = (auth.get("author") or {}).get("display_name")
                if name:
                    authors.append(name)
            if authors:
                bootstrapped["authors"] = authors
        return bootstrapped

    epmc = lookup.get("results", {}).get("europepmc")
    if epmc:
        if not (bootstrapped.get("title") or "").strip():
            bootstrapped["title"] = epmc.get("title") or ""
        if not bootstrapped.get("authors") and epmc.get("authorString"):
            bootstrapped["authors"] = [
                a.strip()
                for a in epmc["authorString"].replace(";", ",").split(",")
                if a.strip()
            ]
        return bootstrapped

    pubmed = lookup.get("results", {}).get("pubmed")
    if pubmed:
        if not (bootstrapped.get("title") or "").strip():
            bootstrapped["title"] = pubmed.get("title") or ""
        if not bootstrapped.get("authors") and pubmed.get("authors"):
            bootstrapped["authors"] = pubmed["authors"]

    return bootstrapped


def search_openalex(title: str, per_page: int = 10) -> dict[str, Any]:
    query = title.strip()[:200]
    if not query:
        return {"source": "openalex", "results": [], "error": "empty title"}

    params: dict[str, str | int] = {
        "search": query,
        "per_page": min(per_page, 25),
    }
    if config.OPENALEX_MAILTO:
        params["mailto"] = config.OPENALEX_MAILTO

    resp = http_client.get_json(
        OPENALEX_BASE,
        params,
        headers=_openalex_headers(),
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if resp.get("error"):
        return {"source": "openalex", "results": [], "error": resp["error"]}
    data = resp["data"]
    return {
        "source": "openalex",
        "results": data.get("results") or [],
        "meta": {"count": (data.get("meta") or {}).get("count", 0)},
        "cached": resp.get("cached", False),
    }


def search_europepmc(title: str, max_results: int = 10) -> dict[str, Any]:
    title_q = title.replace('"', "").strip()[:120]
    if not title_q:
        return {"source": "europepmc", "results": [], "error": "empty title"}

    resp = http_client.get_json(
        EUROPEPMC_BASE,
        {
            "query": f'TITLE:"{title_q}"',
            "format": "json",
            "pageSize": min(max_results, 25),
            "resultType": "core",
        },
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if resp.get("error"):
        return {"source": "europepmc", "results": [], "error": resp["error"]}
    data = resp["data"]
    results = (data.get("resultList") or {}).get("result") or []
    return {
        "source": "europepmc",
        "results": results[:max_results],
        "meta": {"hitCount": data.get("hitCount", 0)},
        "cached": resp.get("cached", False),
    }


def _parse_pubmed_xml(xml_text: str) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    root = ET.fromstring(xml_text)
    for article in root.findall(".//PubmedArticle"):
        medline = article.find("MedlineCitation")
        if medline is None:
            continue
        pmid_el = medline.find("PMID")
        pmid = pmid_el.text if pmline_el is not None else None
        art = medline.find("Article")
        if art is None:
            continue
        title_el = art.find("ArticleTitle")
        title = "".join(title_el.itertext()).strip() if title_el is not None else ""

        authors: list[str] = []
        author_list = art.find("AuthorList")
        if author_list is not None:
            for author in author_list.findall("Author"):
                last = author.find("LastName")
                fore = author.find("ForeName")
                if last is not None and last.text:
                    name = last.text
                    if fore is not None and fore.text:
                        name = f"{fore.text} {name}"
                    authors.append(name)

        journal_el = art.find("Journal/Title")
        journal = journal_el.text if journal_el is not None else None

        year = None
        pub_date = art.find("Journal/JournalIssue/PubDate/Year")
        if pub_date is not None and pub_date.text:
            year = pub_date.text

        doi = None
        for id_el in article.findall(".//ArticleId"):
            if id_el.get("IdType") == "doi" and id_el.text:
                doi = id_el.text
                break

        articles.append(
            {
                "pmid": pmid,
                "title": title,
                "authors": authors,
                "journal": journal,
                "year": year,
                "doi": doi,
            }
        )
    return articles


def search_pubmed(title: str, trait: str = "", max_results: int = 10) -> dict[str, Any]:
    title = title.strip()[:200]
    if not title:
        return {"source": "pubmed", "results": [], "error": "empty title"}

    term = f"({title}[Title])"
    search_resp = http_client.get_json(
        NCBI_ESEARCH,
        _ncbi_params(
            {
                "db": "pubmed",
                "term": term,
                "retmax": min(max_results, 25),
                "retmode": "json",
            }
        ),
        cache_ttl=config.CACHE_TTL_LITERATURE_SEC,
    )
    if search_resp.get("error"):
        return {"source": "pubmed", "results": [], "error": search_resp["error"]}

    id_list = (search_resp["data"].get("esearchresult") or {}).get("idlist") or []
    if not id_list:
        return {"source": "pubmed", "results": [], "meta": {"count": 0}}

    pmids = ",".join(id_list[:max_results])
    fetch_url = f"{NCBI_EFETCH}?{urllib.parse.urlencode(_ncbi_params({'db': 'pubmed', 'id': pmids, 'retmode': 'xml'}))}"

    try:
        req = urllib.request.Request(fetch_url, headers=http_client.build_headers())
        with urllib.request.urlopen(req, timeout=config.HTTP_TIMEOUT_SEC) as resp:
            xml_text = resp.read().decode("utf-8")
        articles = _parse_pubmed_xml(xml_text)
        return {"source": "pubmed", "results": articles, "meta": {"count": len(articles)}}
    except Exception as exc:  # noqa: BLE001
        return {"source": "pubmed", "results": [], "error": str(exc)}


def search_all(title: str, trait: str = "") -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[str]]:
    """Run literature sources in parallel. Returns calls, raw results, and failed source names."""
    search_title = title.strip() or trait.strip()
    calls: dict[str, dict[str, Any]] = {}
    raw: dict[str, dict[str, Any]] = {}
    failed: list[str] = []

    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(search_openalex, search_title): "openalex",
            pool.submit(search_europepmc, search_title): "europepmc",
            pool.submit(search_pubmed, search_title, trait): "pubmed",
        }
        for fut in as_completed(futures):
            key = futures[fut]
            try:
                result = fut.result()
            except Exception as exc:  # noqa: BLE001
                result = {"source": key, "results": [], "error": str(exc)}
            calls[key] = {
                "source": result.get("source", key),
                "hit_count": len(result.get("results") or []),
                "error": result.get("error"),
                "cached": result.get("cached", False),
            }
            raw[key] = result
            if result.get("error"):
                failed.append(key)

    return calls, raw, failed


def probe_sources() -> dict[str, Any]:
    """Health probes for each literature source."""
    probes = {
        "openalex": http_client.probe_url(
            OPENALEX_BASE,
            {"search": "asthma", "per_page": 1},
            timeout=8,
        ),
        "europepmc": http_client.probe_url(
            EUROPEPMC_BASE,
            {"query": "asthma", "format": "json", "pageSize": 1},
            timeout=8,
        ),
        "pubmed": http_client.probe_url(
            NCBI_ESEARCH,
            _ncbi_params({"db": "pubmed", "term": "asthma[Title]", "retmax": 1, "retmode": "json"}),
            timeout=8,
        ),
    }
    return probes
