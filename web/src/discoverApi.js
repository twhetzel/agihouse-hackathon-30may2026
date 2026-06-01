const API_BASE = '';

export async function checkDiscoveryHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return res.json();
}

export async function discoverLiterature(submission) {
  const res = await fetch(`${API_BASE}/api/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Discovery failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return normalizeDiscoveryResponse(data);
}

const PUBLICATION_TYPES = new Set(['catalog_publication', 'literature']);

function isPublicationResult(item) {
  return PUBLICATION_TYPES.has(item?.result_type);
}

function isCatalogStudyResult(item) {
  return item?.result_type === 'catalog_study';
}

function normalizeAccession(accession) {
  if (!accession) return '';
  return String(accession).trim().toUpperCase();
}

/** GCST accessions already surfaced on publication rows (chips / metadata). */
export function collectPublicationLinkedAccessions(publications = []) {
  const linked = new Set();
  for (const pub of publications) {
    for (const acc of pub.linked_accessions || []) {
      const norm = normalizeAccession(acc);
      if (norm) linked.add(norm);
    }
    const primary = normalizeAccession(pub.accession_id);
    if (primary) linked.add(primary);
  }
  return linked;
}

/**
 * Catalog study hits for the supplementary studies panel.
 * Includes pre-publication sumstats always (core discoverability gap), plus
 * published studies not already linked from a publication row above.
 */
export function filterUnlinkedCatalogStudies(catalogStudies = [], publications = []) {
  const linked = collectPublicationLinkedAccessions(publications);
  return catalogStudies.filter((study) => {
    if (study.catalog_status === 'prepublished') return true;
    const acc = normalizeAccession(study.accession_id);
    if (!acc) return true;
    return !linked.has(acc);
  });
}

/** Unify v2 (literature-only) and v3 (Catalog + literature) API shapes for the UI. */
export function normalizeDiscoveryResponse(data) {
  if (Array.isArray(data.related_results) && data.related_results.length > 0) {
    const publicationResults = Array.isArray(data.publication_results)
      ? data.publication_results
      : data.related_results.filter(isPublicationResult);
    const catalogStudyResults = Array.isArray(data.catalog_study_results)
      ? data.catalog_study_results
      : data.related_results.filter(isCatalogStudyResult);
    return {
      ...data,
      publication_results: publicationResults,
      catalog_study_results: catalogStudyResults,
    };
  }

  const catalogStudies = (data.related_catalog_studies || []).map((item) => ({
    ...item,
    result_type: item.result_type || 'catalog_study',
  }));

  const publications = (data.related_publications || []).map((item) => ({
    ...item,
    result_type: item.result_type
      || (item.source === 'gwas_catalog_solr' ? 'catalog_publication' : 'literature'),
  }));

  const relatedResults = [...catalogStudies, ...publications]
    .sort((a, b) => (b.match_signals?.combined_score || 0) - (a.match_signals?.combined_score || 0))
    .map((item, i) => ({ ...item, rank: item.rank || i + 1 }));

  const assessment = data.same_study_assessment || {};
  const discoverySummary = data.discovery_summary || {
    confidence: assessment.confidence || 0,
    relationship: assessment.relationship || 'no_match',
    explanation: assessment.explanation || '',
    top_match: assessment.top_match,
    total_results: relatedResults.length,
    catalog_study_count: catalogStudies.length,
    published_study_count: catalogStudies.filter((s) => s.catalog_status === 'published').length,
    prepublished_study_count: catalogStudies.filter((s) => s.catalog_status === 'prepublished').length,
    publication_count: publications.length,
  };

  return {
    ...data,
    related_results: relatedResults,
    publication_results: publications,
    catalog_study_results: catalogStudies,
    discovery_summary: discoverySummary,
  };
}

export function identifierMatchLabel(match) {
  if (match === 'gcst_exact') return 'Matched by GCST';
  if (match === 'doi_exact') return 'Matched by DOI';
  return null;
}

export function identifierMatchBadgeClass(match) {
  if (match === 'gcst_exact' || match === 'doi_exact') return 'badge-exact';
  return 'badge-auto';
}

export function relationshipLabel(rel) {
  if (rel === 'likely_same_study') return 'Likely same study';
  if (rel === 'related') return 'Related';
  if (rel === 'uncertain') return 'Weak match';
  if (rel === 'no_match') return 'No match found';
  return rel || 'Unknown';
}

export function relationshipBadgeClass(rel) {
  if (rel === 'likely_same_study') return 'badge-exact';
  if (rel === 'related') return 'badge-approximate';
  return 'badge-failed';
}

export function resultTypeLabel(type, item) {
  if (type === 'catalog_study') return 'GWAS Catalog study';
  if (type === 'catalog_publication') return 'GWAS Catalog publication';
  if (type === 'literature') {
    return item?.gwas_catalog_linked ? 'Published paper' : 'Literature';
  }
  return type || 'Result';
}

export function catalogStatusLabel(status) {
  if (status === 'published') return 'GWAS Catalog indexed';
  if (status === 'prepublished') return 'Pre-pub sumstats';
  return null;
}

export function catalogStatusBadgeClass(status) {
  if (status === 'prepublished') return 'badge-ambiguous';
  if (status === 'published') return 'badge-synonym';
  return 'badge-auto';
}

export function resultTypeBadgeClass(type) {
  if (type === 'catalog_study') return 'badge-auto';
  if (type === 'catalog_publication') return 'badge-synonym';
  return 'badge-approximate';
}

/** External links for manually verifying a discovery hit. */
function normalizeLinkHref(href) {
  if (!href) return '';
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return href.trim().replace(/\/$/, '').toLowerCase();
  }
}

export function topMatchLinks(item) {
  if (!item) return [];
  const links = [];
  const seen = new Set();
  const coveredHrefs = new Set();

  const add = (key, label, href) => {
    if (!href || seen.has(key)) return;
    seen.add(key);
    coveredHrefs.add(normalizeLinkHref(href));
    links.push({ key, label, href });
  };

  if (item.pmid) {
    add(`pmid:${item.pmid}`, 'PubMed', `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`);
  }
  const studyAccessions = [...new Set([
    ...(item.linked_accessions || []),
    ...(item.accession_id ? [item.accession_id] : []),
  ])];
  studyAccessions.forEach((acc) => {
    const label = studyAccessions.length === 1 ? 'GWAS Catalog study' : `GWAS study ${acc}`;
    add(`gcst:${acc}`, label, `https://www.ebi.ac.uk/gwas/studies/${acc}`);
  });
  if (item.pmid) {
    add(
      `catalog-pub:${item.pmid}`,
      'Catalog publication',
      `https://www.ebi.ac.uk/gwas/publications/${item.pmid}`,
    );
  }
  if (item.doi) {
    add(`doi:${item.doi}`, `DOI ${item.doi}`, `https://doi.org/${item.doi}`);
  }
  if (item.url && !coveredHrefs.has(normalizeLinkHref(item.url))) {
    add(`url:${item.url}`, 'Paper link', item.url);
  } else if (item.catalog_url && !coveredHrefs.has(normalizeLinkHref(item.catalog_url))) {
    add(`catalog:${item.catalog_url}`, 'Catalog record', item.catalog_url);
  }

  return links;
}
