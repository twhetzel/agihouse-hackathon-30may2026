import React, { useState, useEffect, useRef } from 'react';
import { discoverLiterature, checkDiscoveryHealth } from './discoverApi';
import DiscoveryResults from './DiscoveryResults';
import Tooltip from './Tooltip';
import { THEMES, getStoredTheme, applyTheme } from './theme';

// Import RAW inputs and resources
import originalPrepub from '../../examples/traitgraph_messy_asthma_prepub.json';
import scenario1Prepub from '../../examples/traitgraph_scenario_1_high_confidence.json';
import scenario2Prepub from '../../examples/traitgraph_scenario_2_ambiguous_trait.json';
import scenario3Prepub from '../../examples/traitgraph_scenario_3_no_match.json';

const METADATA_FIELDS_TOOLTIP = (
  <>
    <strong>Need at least one:</strong> title, reported trait, DOI, or GCST (in the GCST field or summary-stats filename).
    <br /><br />
    <strong>Optional:</strong> authors, cohort, notes — improve match scoring but are not required.
    <br /><br />
    <strong>Best results:</strong> title + authors; add trait for Catalog and PubMed coverage.
  </>
);

// SCENARIO DEFINITIONS WITH RAW PREPUB INPUTS
const presets = [
  {
    id: 'original',
    name: 'Probable Match',
    desc: 'Draft asthma GWAS submission — find the published paper behind this metadata',
    prepub: originalPrepub,
  },
  {
    id: 'scenario-1',
    name: 'High Confidence',
    desc: 'Near-identical title/authors — should resolve to the Pividori asthma paper',
    prepub: scenario1Prepub,
  },
  {
    id: 'scenario-2',
    name: 'Ambiguous Trait',
    desc: 'Same study clues but compound trait string (wheeze/asthma/allergy)',
    prepub: scenario2Prepub,
  },
  {
    id: 'scenario-3',
    name: 'Different Cohort',
    desc: 'Similar title, different authors — literature search should not over-match',
    prepub: scenario3Prepub,
  }
];

const STOPWORDS = new Set([
  "of", "in", "and", "the", "analysis", "study", "genome-wide",
  "association", "gwas", "a", "for", "to", "with", "by", "on",
  "at", "from", "cohort", "cohorts", "populations"
]);

function cleanTokens(text) {
  if (!text) return new Set();
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  return new Set(words.filter(w => !STOPWORDS.has(w)));
}

function normalizeAuthor(name) {
  if (!name) return "";
  return name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function computeTitleSimilarity(title1, title2) {
  const tokens1 = cleanTokens(title1);
  const tokens2 = cleanTokens(title2);
  if (tokens1.size === 0 || tokens2.size === 0) return 0.0;
  
  let intersectCount = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) intersectCount++;
  }
  const unionCount = tokens1.size + tokens2.size - intersectCount;
  return intersectCount / unionCount;
}

function computeAuthorSimilarity(authorsPrepub, authorsCatalog) {
  if (!authorsPrepub || !authorsCatalog || authorsPrepub.length === 0 || authorsCatalog.length === 0) return 0.0;
  const normPrepub = new Set(authorsPrepub.map(normalizeAuthor).filter(Boolean));
  const normCatalog = new Set(authorsCatalog.map(normalizeAuthor).filter(Boolean));
  if (normPrepub.size === 0) return 0.0;
  
  let intersectCount = 0;
  for (const a of normPrepub) {
    if (normCatalog.has(a)) intersectCount++;
  }
  return intersectCount / normPrepub.size;
}

function computeFileSimilarity(filePrepub, fileCatalog) {
  if (!filePrepub || !fileCatalog) return 0.0;
  const fPrepub = filePrepub.toLowerCase();
  const fCatalog = fileCatalog.toLowerCase();
  if (fPrepub === fCatalog) return 1.0;
  
  const basePrepub = fPrepub.replace(/(\.tsv|\.csv|\.gz|\.txt)+$/, "");
  const baseCatalog = fCatalog.replace(/(\.tsv|\.csv|\.gz|\.txt)+$/, "");
  
  const tokensPrepub = new Set((basePrepub.match(/\b\w+\b/g) || []).filter(w => !STOPWORDS.has(w) && !["sumstats", "summary", "statistics", "data", "file", "gwas"].includes(w)));
  const tokensCatalog = new Set((baseCatalog.match(/\b\w+\b/g) || []).filter(w => !STOPWORDS.has(w) && !["sumstats", "summary", "statistics", "data", "file", "gwas"].includes(w)));
  
  if (tokensPrepub.size === 0 || tokensCatalog.size === 0) return 0.0;
  
  let intersectCount = 0;
  for (const t of tokensPrepub) {
    if (tokensCatalog.has(t)) intersectCount++;
  }
  return intersectCount > 0 ? 0.5 : 0.0;
}

function reconcilePrepubMetadata(prepubData, catalogRecords) {
  let bestRecord = null;
  let bestConfidence = 0.0;
  let bestExplanation = "No matching records found in mock catalog.";
  let isExact = false;
  let matchesLog = {};
  
  const prepubTitle = prepubData.title || "";
  const prepubAuthors = prepubData.authors || [];
  const prepubFile = prepubData.summary_stats_file || "";
  
  const hasTitle = !!prepubTitle;
  const hasAuthors = prepubAuthors.length > 0;
  const hasFile = !!prepubFile;
  
  const totalWeight = (hasTitle ? 0.4 : 0.0) + (hasAuthors ? 0.3 : 0.0) + (hasFile ? 0.3 : 0.0);
  const normalizedTotalWeight = totalWeight === 0.0 ? 1.0 : totalWeight;
  
  for (const record of catalogRecords) {
    const catalogTitle = record.title || "";
    const catalogAuthors = record.authors || [];
    const catalogFile = record.summary_stats_file || "";
    
    const titleSim = hasTitle ? computeTitleSimilarity(prepubTitle, catalogTitle) : 0.0;
    const authorSim = hasAuthors ? computeAuthorSimilarity(prepubAuthors, catalogAuthors) : 0.0;
    const fileSim = hasFile ? computeFileSimilarity(prepubFile, catalogFile) : 0.0;
    
    const weightedScore = (hasTitle ? 0.4 * titleSim : 0.0) + (hasAuthors ? 0.3 * authorSim : 0.0) + (hasFile ? 0.3 * fileSim : 0.0);
    const confidence = weightedScore / normalizedTotalWeight;
    
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestRecord = record;
      isExact = (!hasTitle || titleSim === 1.0) && (!hasAuthors || authorSim === 1.0) && (!hasFile || fileSim === 1.0);
      
      const explanationParts = [`Matched catalog study '${record.catalog_accession || 'UNKNOWN'}' with confidence ${(confidence * 100).toFixed(2)}%.`];
      if (hasTitle) {
        const cleanPrepub = cleanTokens(prepubTitle);
        const cleanCatalog = cleanTokens(catalogTitle);
        const shared = [...cleanPrepub].filter(t => cleanCatalog.has(t)).sort();
        const sharedStr = "{" + shared.map(t => `'${t}'`).join(", ") + "}";
        explanationParts.push(`Title Jaccard similarity: ${titleSim.toFixed(2)} (shared tokens: ${sharedStr}).`);
      }
      if (hasAuthors) {
        const normPrepub = new Set(prepubAuthors.map(normalizeAuthor).filter(Boolean));
        const normCatalog = new Set(catalogAuthors.map(normalizeAuthor).filter(Boolean));
        const matchedCount = [...normPrepub].filter(a => normCatalog.has(a)).length;
        explanationParts.push(`Author overlap ratio: ${authorSim.toFixed(2)} (matched prepub authors: ${matchedCount}/${prepubAuthors.length}).`);
      }
      if (hasFile) {
        explanationParts.push(`Summary stats file matching score: ${fileSim.toFixed(2)}.`);
      }
      bestExplanation = explanationParts.join(" ");
      
      matchesLog = {
        title_similarity: titleSim,
        author_similarity: authorSim,
        file_similarity: fileSim
      };
    }
  }
  
  if (bestConfidence < 0.4) {
    return {
      best_match: null,
      confidence_score: 0.0,
      explanation: "No catalog record met the minimal confidence threshold of 0.4.",
      is_exact_match: false,
      scores: { title_similarity: 0.0, author_similarity: 0.0, file_similarity: 0.0 }
    };
  }
  
  return {
    best_match: bestRecord,
    confidence_score: Math.round(bestConfidence * 10000) / 10000,
    explanation: bestExplanation,
    is_exact_match: isExact,
    scores: matchesLog
  };
}

// ==========================================
// PURE JAVASCRIPT ONTOLOGY GROUNDING ENGINE
// ==========================================

function groundTraitLocally(reportedTrait) {
  if (!reportedTrait || typeof reportedTrait !== 'string') {
    return {
      ontology_id: null,
      ontology_label: null,
      grounding_type: "failed",
      contains_multiple_concepts: false,
      manual_review_required: true,
      review_reasons: ["Reported trait is empty, missing, or not a string."]
    };
  }
  
  const normalized = reportedTrait.toLowerCase().trim();
  let containsMultiple = false;
  const multipleReasons = [];
  
  if (normalized.includes("/")) {
    containsMultiple = true;
    multipleReasons.push("Reported trait contains slash '/' character indicating alternative or joint phenotypes.");
  }
  if (normalized.includes(",")) {
    containsMultiple = true;
    multipleReasons.push("Reported trait contains comma ',' indicating compound categories.");
  }
  if (normalized.includes(" and ")) {
    containsMultiple = true;
    multipleReasons.push("Reported trait contains 'and' conjunction indicating multiple phenotypes.");
  }
  
  const ontologyDb = {
    "wheeze/asthma/allergy": {
      ontology_id: "MONDO:0004979 | MONDO:0005405 | EFO:0003900",
      ontology_label: "asthma | childhood onset asthma | allergic disease",
      grounding_type: "ambiguous",
      reasons: [
        "Trait maps to multiple distinct concepts: 'wheeze' (approx. MONDO:0005405), 'asthma' (MONDO:0004979), and 'allergy' (EFO:0003900).",
        "Ambiguous combined phenotype requires curator decomposition into independent graph edges."
      ]
    },
    "childhood wheeze/asthma": {
      ontology_id: "MONDO:0005405",
      ontology_label: "childhood onset asthma",
      grounding_type: "approximate",
      reasons: ["Grounding is approximate for combined wheeze/asthma phenotype."]
    },
    "childhood asthma": {
      ontology_id: "MONDO:0005405",
      ontology_label: "childhood onset asthma",
      grounding_type: "synonym",
      reasons: ["Grounding is synonym-based (childhood asthma normalized to childhood onset asthma)."]
    },
    "asthma": {
      ontology_id: "MONDO:0004979",
      ontology_label: "asthma",
      grounding_type: "exact",
      reasons: []
    },
    "type 2 diabetes": {
      ontology_id: "MONDO:0005148",
      ontology_label: "type 2 diabetes mellitus",
      grounding_type: "exact",
      reasons: []
    },
    "adult onset asthma": {
      ontology_id: "EFO:1002011",
      ontology_label: "adult onset asthma",
      grounding_type: "exact",
      reasons: []
    }
  };
  
  const match = ontologyDb[normalized];
  let ontologyId = null;
  let ontologyLabel = null;
  let groundingType = "failed";
  let reasons = [];
  
  if (match) {
    ontologyId = match.ontology_id;
    ontologyLabel = match.ontology_label;
    groundingType = match.grounding_type;
    reasons = [...match.reasons];
  } else {
    if (normalized.includes("asthma")) {
      ontologyId = "MONDO:0004979";
      ontologyLabel = "asthma";
      groundingType = "approximate";
      reasons = ["Fallback keyword mapping: matched 'asthma' as substring of trait expression."];
    } else if (normalized.includes("diabetes")) {
      ontologyId = "MONDO:0005148";
      ontologyLabel = "type 2 diabetes mellitus";
      groundingType = "approximate";
      reasons = ["Fallback keyword mapping: matched 'diabetes' as substring of trait expression."];
    } else {
      ontologyId = null;
      ontologyLabel = null;
      groundingType = "failed";
      reasons = [`No matching ontology term in local database for '${reportedTrait}'.`];
    }
  }
  
  const allReasons = [];
  if (containsMultiple) allReasons.push(...multipleReasons);
  allReasons.push(...reasons);
  
  const manualReview = (groundingType !== "exact") || containsMultiple || (groundingType === "failed");
  
  return {
    ontology_id: ontologyId,
    ontology_label: ontologyLabel,
    grounding_type: groundingType,
    contains_multiple_concepts: containsMultiple,
    manual_review_required: manualReview,
    review_reasons: allReasons
  };
}

// Unified discovery via GWAS Catalog Solr + Science Skills literature search
async function runEngineCalculations(titleVal, traitVal, fileVal, authVal, cVal, pVal, doiVal, nVal, seed) {
  const submission = {
    source_type: "prepublication_summary_statistics_metadata",
    title: titleVal,
    authors: authVal.split(',').map(a => a.trim()).filter(Boolean),
    reported_trait: traitVal,
    doi: doiVal,
    preprint_or_submission_id: pVal,
    summary_stats_file: fileVal,
    cohort: cVal,
    notes: nVal
  };

  const discoveryResult = await discoverLiterature(submission);
  const groundingResult = groundTraitLocally(traitVal);

  return {
    ...discoveryResult,
    submission,
    trait_context: {
      reported_trait: traitVal,
      ontology_id: groundingResult.ontology_id,
      ontology_label: groundingResult.ontology_label,
      grounding_type: groundingResult.grounding_type,
    },
  };
}

export default function App() {
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0].id);

  // EDITABLE PREPUBLICATION METADATA STATE
  const [title, setTitle] = useState('');
  const [reportedTrait, setReportedTrait] = useState('');
  const [authorsRaw, setAuthorsRaw] = useState('');
  const [summaryStatsFile, setSummaryStatsFile] = useState('');
  const [cohort, setCohort] = useState('');
  const [preprintId, setPreprintId] = useState('');
  const [doi, setDoi] = useState('');
  const [notes, setNotes] = useState('');

  // ENGINE STATE FOR DEMO MODE
  const [compiledGraph, setCompiledGraph] = useState(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const [reconcileError, setReconcileError] = useState(null);
  const [serverHealth, setServerHealth] = useState(null);
  const [theme, setTheme] = useState(getStoredTheme);

  // TIMEOUT REF FOR RECONCILER PIPELINE
  const reconciliationTimeoutRef = useRef(null);

  // Clean up any pending timeouts on component unmount
  useEffect(() => {
    return () => {
      if (reconciliationTimeoutRef.current) {
        clearTimeout(reconciliationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    checkDiscoveryHealth()
      .then(setServerHealth)
      .catch(() => setServerHealth({ status: 'offline', science_skills_installed: false }));
  }, []);

  // Load preset metadata into input states AND immediately trigger discovery
  useEffect(() => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (preset && preset.prepub) {
      setTitle(preset.prepub.title || '');
      setReportedTrait(preset.prepub.reported_trait || '');
      setAuthorsRaw((preset.prepub.authors || []).join(', '));
      setSummaryStatsFile(preset.prepub.summary_stats_file || '');
      setCohort(preset.prepub.cohort || '');
      setPreprintId(preset.prepub.preprint_or_submission_id || '');
      setDoi(preset.prepub.doi || '');
      setNotes(preset.prepub.notes || '');

      setIsReconciling(true);
      setReconcileError(null);
      runEngineCalculations(
        preset.prepub.title || '',
        preset.prepub.reported_trait || '',
        preset.prepub.summary_stats_file || '',
        (preset.prepub.authors || []).join(', '),
        preset.prepub.cohort || '',
        preset.prepub.preprint_or_submission_id || '',
        preset.prepub.doi || '',
        preset.prepub.notes || '',
        selectedPresetId
      )
        .then((initialGraph) => {
          setCompiledGraph(initialGraph);
          setIsDirty(false);
        })
        .catch((err) => setReconcileError(err.message || String(err)))
        .finally(() => setIsReconciling(false));
    }
  }, [selectedPresetId]);

  // Track if user changed any inputs from the current compiled state
  const handleInputChange = (fieldSetter, value) => {
    fieldSetter(value);
    setIsDirty(true);
  };

  const handleRunReconciler = async () => {
    setIsReconciling(true);
    setReconcileError(null);

    if (reconciliationTimeoutRef.current) {
      clearTimeout(reconciliationTimeoutRef.current);
      reconciliationTimeoutRef.current = null;
    }

    try {
      const finalGraph = await runEngineCalculations(
        title,
        reportedTrait,
        summaryStatsFile,
        authorsRaw,
        cohort,
        preprintId,
        doi,
        notes,
        selectedPresetId
      );
      setCompiledGraph(finalGraph);
      setIsDirty(false);
    } catch (err) {
      setReconcileError(err.message || String(err));
    } finally {
      setIsReconciling(false);
    }
  };

  if (!compiledGraph) {
    return <div style={{ padding: '3rem', color: 'var(--text-primary)', textAlign: 'center' }}>Initializing GWAS PrePubMatch…</div>;
  }

  const {
    related_results: relatedResults = [],
    publication_results: publicationResults,
    catalog_study_results: catalogStudyResults,
    submission: graphSubmission,
    discovery_summary: discoverySummary = {},
    same_study_assessment: sameStudyAssessment = {},
    identifier_resolution: identifierResolution = {},
  } = compiledGraph;

  const apiOnline = serverHealth?.status === 'ok' || serverHealth?.status === 'degraded';
  const apiStatusLabel = serverHealth?.status === 'degraded' ? 'Degraded' : apiOnline ? 'Online' : 'Offline';

  const getConfidenceColor = (score) => {
    if (score >= 0.70) return 'var(--accent-success)';
    if (score >= 0.40) return 'var(--accent-warning)';
    return 'var(--accent-danger)';
  };

  const toggleTheme = () => {
    const next = theme === THEMES.dark ? THEMES.light : THEMES.dark;
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div style={{ padding: '2rem 1.5rem', maxWidth: '1560px', margin: '0 auto' }}>
      
      {/* HEADER SECTION */}
      <header style={{ marginBottom: '2.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '2.2rem' }}>🧬</span>
              <h1 className="glow-text" style={{ fontSize: '2.5rem', fontWeight: '800', background: 'linear-gradient(to right, var(--heading-gradient-start), var(--heading-gradient-end))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
                GWAS PrePubMatch
              </h1>
              <span className="badge badge-auto" style={{ verticalAlign: 'middle', height: 'fit-content', fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}>
                UNIFIED DISCOVERY
              </span>
              <span className="badge" style={{ 
                verticalAlign: 'middle', 
                height: 'fit-content', 
                background: apiOnline ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: apiOnline ? 'var(--accent-success)' : 'var(--accent-danger)',
                border: apiOnline ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
              }}>
                🔌 API: {apiStatusLabel}{serverHealth?.schema_version ? ` (v${serverHealth.schema_version})` : ''}
                {serverHealth?.science_skills_installed ? ' · Skills' : serverHealth ? ' · HTTP fallback' : ''}
              </span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', maxWidth: '850px', lineHeight: '1.5', marginBottom: '1rem' }}>
              Discover related GWAS Catalog studies — including pre-publication summary statistics — alongside published literature. One search across Catalog Solr, OpenAlex, Europe PMC, and PubMed with transparent match scoring.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '15px', background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-primary)', fontWeight: '500' }}>
                🧬 GWAS Catalog Solr
              </span>
              <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '15px', background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-primary)', fontWeight: '500' }}>
                📚 literature-search-openalex
              </span>
              <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '15px', background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-primary)', fontWeight: '500' }}>
                📖 literature-search-europepmc
              </span>
              <span style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderRadius: '15px', background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-primary)', fontWeight: '500' }}>
                🧬 pubmed-database
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === THEMES.dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === THEMES.dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === THEMES.dark ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </div>
      </header>

      {/* QUICK PRESET LOADERS */}
      <section style={{ marginBottom: '2rem' }}>
        <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
          Load Scenario Preset (Fills Playground Editor)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {presets.map((sc) => {
            const isActive = selectedPresetId === sc.id;
            return (
              <button
                key={sc.id}
                onClick={() => setSelectedPresetId(sc.id)}
                className={`glass-panel ${isActive ? 'pulse-primary' : ''}`}
                style={{
                  textAlign: 'left',
                  padding: '1rem 1.25rem',
                  cursor: 'pointer',
                  border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-glass)',
                  background: isActive ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-surface)',
                  color: 'inherit',
                  outline: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  borderRadius: 'var(--radius-lg)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: '600', color: isActive ? 'var(--accent-active-text)' : 'var(--text-primary)' }}>
                    {sc.name}
                  </span>
                  <span className={`badge ${isActive ? 'badge-auto' : 'badge-failed'}`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.4rem' }}>
                    {isActive ? 'Active' : 'Load'}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.3' }}>
                  {sc.desc}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* WORKFLOW PIPELINE STRIP */}
      <section style={{ marginBottom: '2.5rem' }}>
        <div className="glass-panel" style={{ padding: '1.25rem', background: 'var(--panel-bg-subtle)' }}>
          <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--link-accent)', fontWeight: '700', letterSpacing: '0.08em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>📋</span> GWAS PrePubMatch Pipeline
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', alignItems: 'start' }}>
            <div style={{ background: 'var(--pipeline-step-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--pipeline-step-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ background: 'rgba(99, 102, 241, 0.2)', color: 'var(--link-accent)', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: '0.75rem', fontWeight: '700' }}>1</span>
                <strong style={{ fontSize: '0.9rem', color: 'var(--heading-color)' }}>Submission Input</strong>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Paste pre-publication GWAS submission metadata: title, authors, trait, file clues.
              </p>
            </div>
            <div style={{ background: 'var(--pipeline-step-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--pipeline-step-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: '0.75rem', fontWeight: '700' }}>2</span>
                <strong style={{ fontSize: '0.9rem', color: 'var(--heading-color)' }}>GWAS Catalog + Literature Search</strong>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Parallel GWAS Catalog search and literature (OpenAlex, Europe PMC, PubMed via Science Skills when installed, direct HTTP fallback).
              </p>
            </div>
            <div style={{ background: 'var(--pipeline-step-bg)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--pipeline-step-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#22d3ee', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', fontSize: '0.75rem', fontWeight: '700' }}>3</span>
                <strong style={{ fontSize: '0.9rem', color: 'var(--heading-color)' }}>Rank & Score</strong>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                Deduplicate by DOI/PMID; rank by title, authors, and trait; verify top match.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DASHBOARD CORE GRID */}
      <main style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: '2rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: INTERACTIVE PLAYGROUND EDITOR */}
        <div className="glass-panel" style={{ padding: '1.75rem', position: 'sticky', top: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--divider)', paddingBottom: '0.75rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--heading-color)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>✏️</span>
              <span>GWAS Submission Metadata</span>
              <Tooltip
                content={METADATA_FIELDS_TOOLTIP}
                placement="bottom"
                variant="help-icon"
                label="Which metadata fields are required"
              />
            </h3>
            {isDirty && (
              <span className="badge badge-review" style={{ fontSize: '0.65rem', marginLeft: 'auto', animation: 'pulseGlow 1.5s infinite ease-in-out' }}>
                Pending Changes ⚡
              </span>
            )}
          </div>

          <form style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} onSubmit={(e) => e.preventDefault()}>
            
            {/* Study Title Field */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Study Title
              </label>
              <textarea
                value={title}
                onChange={(e) => handleInputChange(setTitle, e.target.value)}
                style={{
                  width: '100%',
                  height: '75px',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: 'var(--input-text)',
                  fontSize: '0.95rem',
                  fontFamily: 'var(--font-sans)',
                  resize: 'none',
                  outline: 'none',
                  transition: 'var(--transition-smooth)'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-glass)'}
                placeholder="Enter study title to reconcile Jaccard token matching..."
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              
              {/* Reported Trait Field */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                  Reported Trait (Ontology Grounder)
                </label>
                <input
                  type="text"
                  value={reportedTrait}
                  onChange={(e) => handleInputChange(setReportedTrait, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: 'var(--input-text)',
                    fontSize: '0.95rem',
                    outline: 'none',
                    transition: 'var(--transition-smooth)'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-glass)'}
                  placeholder="e.g. childhood asthma"
                />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Tweak to: "asthma", "childhood asthma", "adult onset asthma", "type 2 diabetes", or compound phenolic "wheeze/asthma/allergy".
                </span>
              </div>

              {/* Summary Stats File Field */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                  Summary Stats Filename
                </label>
                <input
                  type="text"
                  value={summaryStatsFile}
                  onChange={(e) => handleInputChange(setSummaryStatsFile, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: 'var(--input-text-muted)',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                    transition: 'var(--transition-smooth)'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-glass)'}
                  placeholder="e.g. filename_sumstats.tsv.gz"
                />
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                  Tweak to: "GCST90001234_sumstats.tsv.gz" for exact data file matching.
                </span>
              </div>

            </div>

            {/* Authors Field */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Prepub Authors (Comma-separated list)
              </label>
              <input
                type="text"
                value={authorsRaw}
                onChange={(e) => handleInputChange(setAuthorsRaw, e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: 'var(--input-text)',
                  fontSize: '0.9rem',
                  outline: 'none',
                  transition: 'var(--transition-smooth)'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-glass)'}
                placeholder="Author A, Author B, Author C..."
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', display: 'block' }}>
                Tweak to: "Pividori M., Schoettler N., Nicolae D. L." to test author overlap.
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              
              {/* Submission ID Field */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                  GCST / submission ID
                </label>
                <input
                  type="text"
                  value={preprintId}
                  onChange={(e) => handleInputChange(setPreprintId, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: 'var(--input-text)',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                  placeholder="e.g. GCST90001234"
                />
              </div>

              {/* DOI Field */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                  DOI
                </label>
                <input
                  type="text"
                  value={doi}
                  onChange={(e) => handleInputChange(setDoi, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: 'var(--input-text-muted)',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none'
                  }}
                  placeholder="10.1101/… or https://doi.org/…"
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Cohort & Sample Details
              </label>
              <input
                type="text"
                value={cohort}
                onChange={(e) => handleInputChange(setCohort, e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: 'var(--input-text)',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* Notes Field */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Submission Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => handleInputChange(setNotes, e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: 'var(--input-text)',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* BIG GLOWING RUN RECONCILER BUTTON */}
            <button
              onClick={handleRunReconciler}
              disabled={isReconciling}
              className="glass-panel"
              style={{
                width: '100%',
                padding: '1rem',
                fontSize: '1.1rem',
                fontWeight: '700',
                cursor: 'pointer',
                background: isDirty ? 'linear-gradient(135deg, #4f46e5, #06b6d4)' : 'var(--chip-bg)',
                color: isDirty ? '#fff' : 'var(--text-primary)',
                border: isDirty ? '1px solid var(--accent-info)' : '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: isDirty ? '0 0 20px rgba(6, 182, 212, 0.4)' : 'none',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                animation: isDirty ? 'pulseGlow 2s infinite ease-in-out' : 'none'
              }}
              onMouseEnter={(e) => {
                if (isDirty) e.target.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'none';
              }}
            >
              {isReconciling ? (
                <>
                  <svg style={{ animation: 'spin 1s linear infinite' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                  Searching GWAS Catalog + literature…
                </>
              ) : (
                <>
                  <span>⚡</span>
                  Discover Related Studies
                </>
              )}
            </button>

            {reconcileError && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--accent-danger)' }}>
                Discovery failed: {reconcileError}
              </p>
            )}

          </form>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
        <DiscoveryResults
          isReconciling={isReconciling}
          relatedResults={relatedResults}
          publicationResults={publicationResults}
          catalogStudyResults={catalogStudyResults}
          submission={graphSubmission}
          discoverySummary={discoverySummary}
          sameStudyAssessment={sameStudyAssessment}
          identifierResolution={identifierResolution}
          getConfidenceColor={getConfidenceColor}
        />

        </div>

      </main>

      {/* FOOTER */}
      <footer style={{ marginTop: '4rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        GWAS PrePubMatch • Google Science Skills • OpenAlex · Europe PMC · PubMed
      </footer>

    </div>
  );
}
