const FETCH_TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAuthor(name) {
  if (!name) return '';
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

const STOPWORDS = new Set([
  'of', 'in', 'and', 'the', 'analysis', 'study', 'genome-wide',
  'association', 'gwas', 'a', 'for', 'to', 'with', 'by', 'on',
]);

function cleanTokens(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

function titleJaccard(a, b) {
  const t1 = cleanTokens(a);
  const t2 = cleanTokens(b);
  if (t1.size === 0 || t2.size === 0) return 0;
  let intersect = 0;
  for (const t of t1) {
    if (t2.has(t)) intersect++;
  }
  const union = t1.size + t2.size - intersect;
  return intersect / union;
}

function authorOverlap(prepubAuthors, catalogAuthors) {
  if (!prepubAuthors?.length || !catalogAuthors?.length) return 0;
  const normPrepub = new Set(prepubAuthors.map(normalizeAuthor).filter(Boolean));
  const normCatalog = new Set(catalogAuthors.map(normalizeAuthor).filter(Boolean));
  if (normPrepub.size === 0) return 0;
  let intersect = 0;
  for (const a of normPrepub) {
    if (normCatalog.has(a)) intersect++;
  }
  return intersect / normPrepub.size;
}

function openAlexAuthorNames(work) {
  return (work.authorships || [])
    .map((a) => a.author?.display_name)
    .filter(Boolean);
}

export async function verifyOpenAlexLive(prepubData) {
  const title = (prepubData?.title || '').trim();
  const authors = prepubData?.authors || [];
  if (!title) {
    return {
      mode: 'unavailable',
      publication_match_status: 'not_verified',
      title_verified: false,
      author_overlap_verified: false,
      source: 'OpenAlex API',
      evidence_summary: 'No study title provided for OpenAlex search.',
    };
  }

  try {
    const q = encodeURIComponent(title.slice(0, 200));
    const data = await fetchJson(`https://api.openalex.org/works?search=${q}&per_page=5`);
    const works = data.results || [];
    if (works.length === 0) {
      return {
        mode: 'live',
        publication_match_status: 'not_verified',
        title_verified: false,
        author_overlap_verified: false,
        source: 'OpenAlex API (live)',
        evidence_summary: `OpenAlex returned 0 works for title search.`,
        works_found: 0,
      };
    }

    let best = works[0];
    let bestTitleSim = titleJaccard(title, best.display_name || best.title || '');
    for (const w of works.slice(1)) {
      const sim = titleJaccard(title, w.display_name || w.title || '');
      if (sim > bestTitleSim) {
        best = w;
        bestTitleSim = sim;
      }
    }

    const oaAuthors = openAlexAuthorNames(best);
    const authorSim = authorOverlap(authors, oaAuthors);
    const titleVerified = bestTitleSim >= 0.45;
    const authorVerified = authorSim >= 0.3;
    const doi = best.doi || best.ids?.doi || null;
    const openalexId = best.id || null;

    let status = 'not_verified';
    if (titleVerified && authorVerified) status = 'verified';
    else if (titleVerified) status = 'partially_verified';

    return {
      mode: 'live',
      publication_match_status: status,
      title_verified: titleVerified,
      author_overlap_verified: authorVerified,
      source: 'OpenAlex API (live)',
      evidence_summary: `Live OpenAlex: best match "${(best.display_name || '').slice(0, 80)}…" (title Jaccard ${(bestTitleSim * 100).toFixed(0)}%, author overlap ${(authorSim * 100).toFixed(0)}%).`,
      works_found: works.length,
      matched_work_title: best.display_name || best.title,
      doi,
      openalex_id: openalexId,
      openalex_url: openalexId,
    };
  } catch (err) {
    return {
      mode: 'unavailable',
      publication_match_status: 'not_verified',
      title_verified: false,
      author_overlap_verified: false,
      source: 'OpenAlex API',
      evidence_summary: `OpenAlex request failed: ${err.message || err}.`,
    };
  }
}

export async function verifyEuropePmcLive(prepubData) {
  const title = (prepubData?.title || '').trim();
  const authors = prepubData?.authors || [];
  if (!title) {
    return {
      mode: 'unavailable',
      evidence_status: 'does_not_support',
      source: 'Europe PMC REST API',
      evidence_summary: 'No title for literature search.',
      review_impact: 'supports_do_not_merge',
    };
  }

  try {
    const titleQ = title.replace(/"/g, '').slice(0, 120);
    const query = encodeURIComponent(`TITLE:"${titleQ}"`);
    const data = await fetchJson(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&pageSize=5`
    );
    const hits = data.resultList?.result || [];
    if (hits.length === 0) {
      return {
        mode: 'live',
        evidence_status: 'does_not_support',
        source: 'Europe PMC REST API (live)',
        evidence_summary: 'Live Europe PMC: no publications matched this exact title query.',
        review_impact: 'supports_do_not_merge',
        hits_found: 0,
      };
    }

    const best = hits[0];
    const hitAuthors = (best.authorString || '').split(/[,;]/).map((a) => a.trim()).filter(Boolean);
    const authorSim = authorOverlap(authors, hitAuthors);
    const titleSim = titleJaccard(title, best.title || '');
    const strong = titleSim >= 0.4 && (authorSim >= 0.25 || authors.length === 0);

    return {
      mode: 'live',
      evidence_status: strong ? 'supports_match' : 'supports_review',
      source: 'Europe PMC REST API (live)',
      evidence_summary: `Live Europe PMC: "${(best.title || '').slice(0, 80)}…" (${best.source || 'unknown'}, ${best.pubYear || 'n.d.'}) — title ${(titleSim * 100).toFixed(0)}%, authors ${(authorSim * 100).toFixed(0)}%.`,
      review_impact: strong ? 'supports_auto_merge' : 'supports_curator_review',
      hits_found: hits.length,
      pmid: best.pmid || null,
      doi: best.doi || null,
    };
  } catch (err) {
    return {
      mode: 'unavailable',
      evidence_status: 'does_not_support',
      source: 'Europe PMC REST API',
      evidence_summary: `Europe PMC request failed: ${err.message || err}.`,
      review_impact: 'supports_curator_review',
    };
  }
}

export async function queryOlsLive(reportedTrait) {
  const query = (reportedTrait || '').trim();
  if (!query) return null;

  for (const ontology of ['efo', 'mondo']) {
    try {
      const url = `https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(query)}&ontology=${ontology}&rows=3`;
      const data = await fetchJson(url);
      const docs = data.response?.docs || [];
      if (docs.length === 0) continue;
      const best = docs[0];
      return {
        ontology_id: best.obo_id || best.short_form,
        ontology_label: best.label,
        ontology_name: ontology,
        grounding_type: 'exact',
        grounding_source: 'ols_live',
        iri: best.iri,
        ols_score: best.ontology_name,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function groundTraitWithLiveApis(reportedTrait, localGroundFn) {
  const local = localGroundFn(reportedTrait);
  const normalized = (reportedTrait || '').toLowerCase().trim();

  if (local.contains_multiple_concepts || local.grounding_type === 'ambiguous') {
    return { ...local, grounding_source: 'local_lookup' };
  }

  const ols = await queryOlsLive(reportedTrait);
  if (ols) {
    return {
      ontology_id: ols.ontology_id,
      ontology_label: ols.ontology_label,
      grounding_type: ols.grounding_type,
      contains_multiple_concepts: false,
      manual_review_required: false,
      review_reasons: [`Live OLS (${ols.ontology_name}): matched "${ols.ontology_label}" (${ols.ontology_id}).`],
      grounding_source: 'ols_live',
      ols_iri: ols.iri,
    };
  }

  return { ...local, grounding_source: 'local_lookup' };
}

export async function runLiveVerifications(prepubData) {
  const [openalex, literature] = await Promise.all([
    verifyOpenAlexLive(prepubData),
    verifyEuropePmcLive(prepubData),
  ]);
  return {
    openalex_publication_verification: openalex,
    literature_evidence_verification: literature,
  };
}
