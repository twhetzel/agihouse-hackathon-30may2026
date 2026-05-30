import React, { useState, useEffect, useRef } from 'react';
import { generateBiocuratorReport } from './gemini';

// Import RAW inputs and resources
import mockCatalog from '../../resources/traitgraph_mock_catalog_records.json';
import originalPrepub from '../../examples/traitgraph_messy_asthma_prepub.json';
import scenario1Prepub from '../../examples/traitgraph_scenario_1_high_confidence.json';
import scenario2Prepub from '../../examples/traitgraph_scenario_2_ambiguous_trait.json';
import scenario3Prepub from '../../examples/traitgraph_scenario_3_no_match.json';

// SCENARIO DEFINITIONS WITH RAW PREPUB INPUTS
const presets = [
  {
    id: 'original',
    name: 'Original MVP Demo',
    desc: 'Childhood wheeze/asthma with probable study match & approximate grounding',
    prepub: originalPrepub,
  },
  {
    id: 'scenario-1',
    name: 'Scenario 1: High Confidence',
    desc: 'Childhood asthma with identical title/authors/stats-file (100% study match)',
    prepub: scenario1Prepub,
  },
  {
    id: 'scenario-2',
    name: 'Scenario 2: Ambiguous Trait',
    desc: 'wheeze/asthma/allergy mapping to multiple ontology concepts',
    prepub: scenario2Prepub,
  },
  {
    id: 'scenario-3',
    name: 'Scenario 3: No Catalog Match',
    desc: 'Similar title but different cohort/authors (prevents over-matching)',
    prepub: scenario3Prepub,
  }
];

// ==========================================
// PURE JAVASCRIPT RECONCILIATION CORE ENGINE
// ==========================================

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

function generateUUID(seed) {
  let val = 0;
  for (let i = 0; i < seed.length; i++) {
    val += seed.charCodeAt(i);
  }
  return `traitgraph-node-7b02-${val}-adea-${val % 100}d56ade33495`;
}

function compileGraphReadyJson(prepubData, matchResult, groundingResult, seed = "demo") {
  const reviewReasons = [];
  
  const bestMatch = matchResult.best_match;
  const confidenceScore = matchResult.confidence_score || 0.0;
  const isExactStudy = matchResult.is_exact_match || false;
  
  if (!bestMatch) {
    reviewReasons.push("No matching record found in mock catalog.");
  } else if (!isExactStudy) {
    reviewReasons.push(`Study match is probable rather than exact (Confidence: ${(confidenceScore * 100).toFixed(2)}%).`);
    if (confidenceScore < 0.70) {
      reviewReasons.push("Study match confidence score is low (< 70%).");
    }
  }
  
  const groundingReview = groundingResult.manual_review_required;
  const groundingReasons = groundingResult.review_reasons || [];
  
  if (groundingReview || groundingReasons.length > 0) {
    reviewReasons.push(...groundingReasons);
  }
  
  const manualReviewRequired = (!bestMatch) || (!isExactStudy) || groundingReview || (confidenceScore < 0.70);
  
  // Deduplicate
  const uniqueReasons = [...new Set(reviewReasons)];
  
  return {
    graph_schema_version: "1.0.0",
    entity_id: generateUUID(prepubData.title || seed),
    submitted_metadata: prepubData,
    matched_catalog_record: bestMatch,
    reconciliation: {
      confidence_score: confidenceScore,
      explanation: matchResult.explanation || "",
      is_exact_match: isExactStudy,
      scores: matchResult.scores
    },
    normalized_trait: {
      ontology_id: groundingResult.ontology_id,
      ontology_label: groundingResult.ontology_label,
      grounding_type: groundingResult.grounding_type,
      contains_multiple_concepts: groundingResult.contains_multiple_concepts
    },
    provenance: {
      tool_name: "TraitGraph GWAS Reconciler MVP Live Engine",
      tool_version: "0.1.0",
      timestamp: new Date().toISOString().replace(/\.\d{3}/, ""),
      run_id: generateUUID(prepubData.reported_trait || seed)
    },
    review_flags: {
      manual_review_required: manualReviewRequired,
      reasons: uniqueReasons
    }
  };
}

// Helper to run full calculations on inputs
function runEngineCalculations(titleVal, traitVal, fileVal, authVal, cVal, pVal, nVal, seed) {
  const currentPrepubData = {
    source_type: "prepublication_summary_statistics_metadata",
    title: titleVal,
    authors: authVal.split(',').map(a => a.trim()).filter(Boolean),
    reported_trait: traitVal,
    preprint_or_submission_id: pVal,
    summary_stats_file: fileVal,
    cohort: cVal,
    notes: nVal
  };
  const matchResult = reconcilePrepubMetadata(currentPrepubData, mockCatalog);
  const groundingResult = groundTraitLocally(traitVal);
  const graphJson = compileGraphReadyJson(currentPrepubData, matchResult, groundingResult, seed);
  return graphJson;
}

export default function App() {
  const [selectedPresetId, setSelectedPresetId] = useState(presets[0].id);
  const [copied, setCopied] = useState(false);

  // EDITABLE PREPUBLICATION METADATA STATE
  const [title, setTitle] = useState('');
  const [reportedTrait, setReportedTrait] = useState('');
  const [authorsRaw, setAuthorsRaw] = useState('');
  const [summaryStatsFile, setSummaryStatsFile] = useState('');
  const [cohort, setCohort] = useState('');
  const [preprintId, setPreprintId] = useState('');
  const [notes, setNotes] = useState('');

  // ENGINE STATE FOR DEMO MODE
  const [compiledGraph, setCompiledGraph] = useState(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // GEMINI API CURATION STATES
  const [apiKey, setApiKey] = useState(() => {
    const envKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (envKey && envKey !== 'your_gemini_api_key_here') {
      return envKey;
    }
    const saved = localStorage.getItem('traitgraph_gemini_api_key') || '';
    return saved || '';
  });

  const [aiReport, setAiReport] = useState(null);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiError, setAiError] = useState(null);

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

  // Load preset metadata into input states AND immediately trigger a clean compile
  useEffect(() => {
    const preset = presets.find(p => p.id === selectedPresetId);
    if (preset && preset.prepub) {
      setTitle(preset.prepub.title || '');
      setReportedTrait(preset.prepub.reported_trait || '');
      setAuthorsRaw((preset.prepub.authors || []).join(', '));
      setSummaryStatsFile(preset.prepub.summary_stats_file || '');
      setCohort(preset.prepub.cohort || '');
      setPreprintId(preset.prepub.preprint_or_submission_id || '');
      setNotes(preset.prepub.notes || '');

      // Clear AI reports when presets change
      setAiReport(null);
      setAiError(null);

      // Compile immediately on preset load
      const initialGraph = runEngineCalculations(
        preset.prepub.title || '',
        preset.prepub.reported_trait || '',
        preset.prepub.summary_stats_file || '',
        (preset.prepub.authors || []).join(', '),
        preset.prepub.cohort || '',
        preset.prepub.preprint_or_submission_id || '',
        preset.prepub.notes || '',
        selectedPresetId
      );
      setCompiledGraph(initialGraph);
      setIsDirty(false);
    }
  }, [selectedPresetId]);

  // Track if user changed any inputs from the current compiled state
  const handleInputChange = (fieldSetter, value) => {
    fieldSetter(value);
    setIsDirty(true);
    // Clear AI reports when inputs are edited
    setAiReport(null);
    setAiError(null);
  };

  // PUSH BUTTON TO RUN ENGINE (WITH A BEAUTIFUL GRAPHIC LOAD SHIFT)
  const handleRunReconciler = () => {
    setIsReconciling(true);
    // Clear AI reports when re-running local reconciler
    setAiReport(null);
    setAiError(null);
    
    if (reconciliationTimeoutRef.current) {
      clearTimeout(reconciliationTimeoutRef.current);
    }
    
    // Simulate high-performance metadata reconciliation pipeline processing
    reconciliationTimeoutRef.current = setTimeout(() => {
      const finalGraph = runEngineCalculations(
        title,
        reportedTrait,
        summaryStatsFile,
        authorsRaw,
        cohort,
        preprintId,
        notes,
        selectedPresetId
      );
      setCompiledGraph(finalGraph);
      setIsReconciling(false);
      setIsDirty(false);
      reconciliationTimeoutRef.current = null;
    }, 850);
  };

  // EXECUTE LIVE GEMINI API BIOCURATOR REPORT (gemini-2.5-flash)
  const handleExecuteAiReport = async () => {
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      setAiError("Missing Gemini API Key. Please set VITE_GEMINI_API_KEY inside the git-ignored web/.env.local file.");
      return;
    }
    setIsAiRunning(true);
    setAiError(null);

    try {
      const report = await generateBiocuratorReport({
        apiKey,
        inputMetadata: compiledGraph.submitted_metadata,
        matchedRecord: compiledGraph.matched_catalog_record,
        verification: compiledGraph,
        localScores: compiledGraph.reconciliation?.scores || { title_similarity: 0, author_similarity: 0, file_similarity: 0 }
      });

      setAiReport(report);
      
      // Dynamic addition of ai_insights block to the displayed graph-ready JSON preview
      const updatedGraph = {
        ...compiledGraph,
        ai_insights: report
      };
      setCompiledGraph(updatedGraph);

    } catch (err) {
      setAiError(err.message || String(err));
    } finally {
      setIsAiRunning(false);
    }
  };

  const fallbackCopyText = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error("Fallback copy command was unsuccessful");
      }
    } catch (err) {
      console.error("Fallback copy failed: ", err);
    }
  };

  const copyToClipboard = () => {
    if (!compiledGraph) return;
    const text = JSON.stringify(compiledGraph, null, 4);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch((err) => {
          console.error("Failed to copy text with Clipboard API: ", err);
          fallbackCopyText(text);
        });
    } else {
      fallbackCopyText(text);
    }
  };

  const getGroundingBadgeClass = (type) => {
    switch (type?.toLowerCase()) {
      case 'exact': return 'badge-exact';
      case 'synonym': return 'badge-synonym';
      case 'approximate': return 'badge-approximate';
      case 'ambiguous': return 'badge-ambiguous';
      default: return 'badge-failed';
    }
  };

  if (!compiledGraph) {
    return <div style={{ padding: '3rem', color: '#fff', textAlign: 'center' }}>Initializing TraitGraph live runtime...</div>;
  }

  const { matched_catalog_record, reconciliation, normalized_trait, review_flags, provenance } = compiledGraph;
  const confidenceScore = reconciliation?.confidence_score || 0;
  const confidencePercent = `${(confidenceScore * 100).toFixed(1)}%`;

  const getConfidenceColor = (score) => {
    if (score >= 0.70) return 'var(--accent-success)';
    if (score >= 0.40) return 'var(--accent-warning)';
    return 'var(--accent-danger)';
  };

  return (
    <div style={{ padding: '2rem 1.5rem', maxWidth: '1560px', margin: '0 auto' }}>
      
      {/* HEADER SECTION */}
      <header style={{ marginBottom: '2.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '2.2rem' }}>🧬</span>
              <h1 className="glow-text" style={{ fontSize: '2.2rem', fontWeight: '700', background: 'linear-gradient(to right, #ffffff, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                TraitGraph Live Playground
              </h1>
              <span className="badge badge-auto" style={{ verticalAlign: 'middle', height: 'fit-content' }}>Real-time Curation</span>
              {apiKey && apiKey !== "your_gemini_api_key_here" ? (
                <span className="badge" style={{ verticalAlign: 'middle', height: 'fit-content', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-success)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>🧠 Gemini Active</span>
              ) : (
                <span className="badge" style={{ verticalAlign: 'middle', height: 'fit-content', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>🧠 Gemini Offline</span>
              )}
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', maxWidth: '900px', lineHeight: '1.5' }}>
              Study reconciliation and trait ontology grounding running **live in-browser**. Load a scenario preset, tweak fields inside the playground, and **click the glowing "Run Reconciliation Engine" button** to witness high-performance Jaccard metrics and EFO tags compute with dramatic demo transitions!
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="glass-panel" style={{ padding: '0.75rem 1.25rem', textAlign: 'center', minWidth: '130px', height: 'fit-content' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Catalog Studies</div>
              <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--accent-info)' }}>{mockCatalog.length} records</div>
            </div>
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
                  <span style={{ fontSize: '0.95rem', fontWeight: '600', color: isActive ? '#a5b4fc' : 'var(--text-primary)' }}>
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

      {/* DASHBOARD CORE GRID */}
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '2rem', alignItems: 'start' }}>
        
        {/* LEFT COLUMN: INTERACTIVE PLAYGROUND EDITOR */}
        <div className="glass-panel" style={{ padding: '1.75rem', position: 'sticky', top: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.25rem' }}>✏️</span>
            <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Interactive Curation Playground</h3>
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
                Study Title (Jaccard Matcher Source)
              </label>
              <textarea
                value={title}
                onChange={(e) => handleInputChange(setTitle, e.target.value)}
                style={{
                  width: '100%',
                  height: '75px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: '#fff',
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
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: '#fff',
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
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: '#cbd5e1',
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
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: '#fff',
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
                  preprint / submission ID
                </label>
                <input
                  type="text"
                  value={preprintId}
                  onChange={(e) => handleInputChange(setPreprintId, e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Cohort Field */}
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
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '6px',
                    padding: '0.6rem',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>

            </div>

            {/* Notes Field */}
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
                Curator Ingestion Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => handleInputChange(setNotes, e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-glass)',
                  borderRadius: '6px',
                  padding: '0.6rem',
                  color: '#fff',
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
                background: isDirty ? 'linear-gradient(135deg, #4f46e5, #06b6d4)' : 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
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
                  Processing GWAS Metadata...
                </>
              ) : (
                <>
                  <span>⚡</span>
                  Run Reconciliation Engine
                </>
              )}
            </button>

          </form>
        </div>

        {/* RIGHT COLUMN: LIVE RECONCILIATION & ONTOLOGY OUTPUTS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
          
          {/* BEAUTIFUL PROCESSING TRANSITION OVERLAY */}
          {isReconciling && (
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(10, 13, 22, 0.85)',
              backdropFilter: 'blur(8px)',
              zIndex: 10,
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              boxShadow: '0 0 30px rgba(99, 102, 241, 0.1)'
            }}>
              <svg style={{ animation: 'spin 1.5s linear infinite' }} width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
              <h3 className="glow-text" style={{ color: 'var(--accent-primary)', fontWeight: '700', fontSize: '1.3rem' }}>Processing Curation Pipeline</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Aligning Jaccard title vectors & mapping ontology graphs...</p>
            </div>
          )}

          {/* study reconciliation outcomes card */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>⚖️</span>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Study Reconciliation Live Outcomes</h3>
              </div>
              <span className="badge" style={{ 
                background: confidenceScore >= 0.70 ? 'rgba(16, 185, 129, 0.1)' : confidenceScore >= 0.40 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                color: getConfidenceColor(confidenceScore),
                border: `1px solid ${getConfidenceColor(confidenceScore)}`
              }}>
                {confidenceScore >= 0.70 ? 'High Confidence' : confidenceScore >= 0.40 ? 'Probable Match' : 'No Confident Match'}
              </span>
            </div>

            {matched_catalog_record ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                
                {/* Live Jaccard confidence score meter */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Reconciliation Confidence</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: '700', color: getConfidenceColor(confidenceScore) }}>{confidencePercent}</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: confidencePercent, height: '100%', background: getConfidenceColor(confidenceScore), transition: 'width 0.3s ease-in-out', boxShadow: `0 0 10px ${getConfidenceColor(confidenceScore)}` }}></div>
                  </div>
                </div>

                {/* Score weights list */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', background: 'rgba(0,0,0,0.15)', padding: '0.6rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Title Jaccard (40%)</div>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#fff', marginTop: '0.15rem' }}>{((reconciliation?.confidence_score ? reconciliation.scores?.title_similarity : 0) * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Author Overlap (30%)</div>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#fff', marginTop: '0.15rem' }}>{((reconciliation?.confidence_score ? reconciliation.scores?.author_similarity : 0) * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>File Overlap (30%)</div>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: '#fff', marginTop: '0.15rem' }}>{((reconciliation?.confidence_score ? reconciliation.scores?.file_similarity : 0) * 100).toFixed(0)}%</div>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Best Reconciled Study</span>
                  <p style={{ fontSize: '1.05rem', marginTop: '0.25rem', color: '#fff', fontWeight: '500', lineHeight: '1.4' }}>
                    "{matched_catalog_record.title}"
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>GWAS Accession ID</span>
                    <p style={{ marginTop: '0.25rem', fontSize: '1.05rem', fontWeight: '700', color: 'var(--accent-primary)' }}>
                      {matched_catalog_record.catalog_accession}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Publication PMID</span>
                    <p style={{ marginTop: '0.25rem', fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {matched_catalog_record.publication_id}
                    </p>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Reconciliation Explanation</span>
                  <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.03)' }}>
                    {reconciliation?.explanation}
                  </p>
                </div>

              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '2.5rem' }}>❌</span>
                <h4 style={{ color: '#ef4444', fontWeight: '600' }}>No Confident Match Reconciled</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '380px', lineHeight: '1.4' }}>
                  Overall calculated Jaccard metric is below the 40% threshold ({confidencePercent}). Automatic merge blocked to prevent duplicate entries and database pollution.
                </p>
              </div>
            )}
          </div>

          {/* ontology grounding outcomes card */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🧬</span>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Ontology Grounding Live Outcomes</h3>
              </div>
              <span className={`badge ${getGroundingBadgeClass(normalized_trait?.grounding_type)}`}>
                {normalized_trait?.grounding_type || 'FAILED'} Grounding
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Standardized Ontology Label</span>
                  <p style={{ marginTop: '0.25rem', fontSize: '1.1rem', fontWeight: '600', color: '#fff' }}>
                    {normalized_trait?.ontology_label || 'FAILED MAPPING'}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Ontology ID</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--accent-info)', fontFamily: 'var(--font-mono)' }}>
                      {normalized_trait?.ontology_id || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Multi-Concept Flag</span>
                  <p style={{ marginTop: '0.25rem', fontSize: '0.95rem', fontWeight: '600', color: normalized_trait?.contains_multiple_concepts ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                    {normalized_trait?.contains_multiple_concepts ? 'YES [Compound Phenotype] ⚠️' : 'NO [Single Concept] ✅'}
                  </p>
                </div>
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Curation Action Required</span>
                  <p style={{ marginTop: '0.25rem', fontSize: '0.95rem', fontWeight: '600', color: review_flags?.manual_review_required ? 'var(--accent-warning)' : 'var(--accent-success)' }}>
                    {review_flags?.manual_review_required ? 'YES [Manual Review]' : 'NO [Auto Ingestion]'}
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* review flags action card */}
          <div className="glass-panel" style={{ 
            padding: '1.5rem 1.75rem', 
            borderLeft: review_flags?.manual_review_required ? '4px solid var(--accent-danger)' : '4px solid var(--accent-success)',
            background: review_flags?.manual_review_required ? 'linear-gradient(to right, rgba(239, 68, 68, 0.04), transparent)' : 'linear-gradient(to right, rgba(16, 185, 129, 0.04), transparent)'
          }}>
            {review_flags?.manual_review_required ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                  <h4 style={{ color: 'var(--accent-danger)', fontWeight: '600' }}>Curation Alert [Manual Review Triggered]</h4>
                </div>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                  {review_flags.reasons?.map((reason, i) => (
                    <li key={i} style={{ color: '#fca5a5' }}>• {reason}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.5rem', color: 'var(--accent-success)' }}>✅</span>
                <div>
                  <h4 style={{ color: 'var(--accent-success)', fontWeight: '600' }}>Ready for Automatic Ingestion</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                    Study reconciliation match meets confidence and grounding is exact. No review reasons triggered.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* GEMINI AI BIOCURATOR CARD */}
          <div className="glass-panel" style={{ 
            padding: '1.75rem', 
            border: '1px solid rgba(139, 92, 246, 0.3)',
            boxShadow: '0 0 20px rgba(139, 92, 246, 0.1)',
            background: 'linear-gradient(to bottom right, rgba(139, 92, 246, 0.03), transparent)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🧠</span>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', fontWeight: '600' }}>Live Gemini Biocurator Report</h3>
              </div>
              <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
                gemini-2.5-flash
              </span>
            </div>

            {aiReport ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                
                {/* Curator Recommendation */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '500' }}>AI Curator Recommendation</span>
                  <span className={`badge ${
                    aiReport.curator_recommendation === 'auto_merge' ? 'badge-exact' :
                    aiReport.curator_recommendation === 'curator_review' ? 'badge-approximate' : 'badge-review'
                  }`} style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
                    {aiReport.curator_recommendation?.replace(/_/g, ' ')}
                  </span>
                </div>

                {/* Semantic Study Match Analysis */}
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em' }}>Semantic Study Match Analysis</span>
                  <p style={{ marginTop: '0.35rem', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.5', background: 'rgba(0, 0, 0, 0.2)', padding: '0.85rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.03)' }}>
                    {aiReport.semantic_study_match_analysis}
                  </p>
                </div>

                {/* Ontology Concept Decomposition */}
                <div>
                  <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem' }}>Ontology Concept Decomposition</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {aiReport.ontology_decomposition?.map((dec, i) => (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px', padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
                          <span style={{ fontWeight: '600', color: '#fff', fontSize: '0.95rem' }}>"{dec.concept}"</span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {dec.suggested_id && (
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--accent-info)', fontWeight: '600' }}>
                                {dec.suggested_id}
                              </span>
                            )}
                            <span className="badge badge-synonym" style={{ fontSize: '0.6rem', padding: '0.1rem 0.4rem', background: 'rgba(59,130,246,0.1)' }}>
                              {dec.suggestion_status}
                            </span>
                          </div>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                          {dec.reasoning}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Uncertainty & Review Notes */}
                {aiReport.uncertainty_notes && aiReport.uncertainty_notes.length > 0 && (
                  <div>
                    <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '600', letterSpacing: '0.05em', display: 'block', marginBottom: '0.35rem' }}>Uncertainty & Review Notes</span>
                    <ul style={{ paddingLeft: '1.2rem', color: '#fda4af', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', lineHeight: '1.4' }}>
                      {aiReport.uncertainty_notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', padding: '1.5rem 0', textAlign: 'center' }}>
                <span style={{ fontSize: '2.5rem' }}>🧠</span>
                <div>
                  <h4 style={{ fontWeight: '600', color: '#fff', marginBottom: '0.25rem' }}>AI Biocurator Analysis Layer</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '380px', lineHeight: '1.4' }}>
                    Generate dynamic, AI-powered semantic validations and concept decompositions using Gemini 2.5 Flash.
                  </p>
                </div>
                 {(!apiKey || apiKey === 'your_gemini_api_key_here') && (
                  <div style={{
                    width: '100%',
                    maxWidth: '380px',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(139, 92, 246, 0.15)',
                    borderRadius: '8px',
                    padding: '1rem',
                    textAlign: 'left',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
                  }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)', fontWeight: '600', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                      🔑 Enter Gemini API Key
                    </label>
                    <input
                      type="password"
                      value={apiKey === 'your_gemini_api_key_here' ? '' : apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: '6px',
                        padding: '0.5rem 0.75rem',
                        fontSize: '0.85rem',
                        color: '#fff',
                        outline: 'none',
                        transition: 'border 0.2s'
                      }}
                    />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.5rem', lineHeight: '1.3' }}>
                      Key will be kept in React state memory. To persist permanently, write it to the git-ignored <code style={{ color: 'var(--accent-info)' }}>web/.env.local</code> file!
                    </p>
                  </div>
                )}

                {aiError && (
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-danger)', borderRadius: '6px', padding: '0.75rem 1rem', color: '#fca5a5', fontSize: '0.85rem', maxWidth: '420px', lineHeight: '1.4', textAlign: 'left' }}>
                    ⚠️ {aiError}
                  </div>
                )}

                <button
                  onClick={handleExecuteAiReport}
                  disabled={isAiRunning}
                  style={{
                    padding: '0.75rem 1.5rem',
                    fontSize: '0.95rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
                    color: '#fff',
                    border: '1px solid rgba(139,92,246,0.4)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'var(--transition-smooth)',
                    opacity: 1
                  }}
                >
                  {isAiRunning ? (
                    <>
                      <svg style={{ animation: 'spin 1s linear infinite' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
                      Gemini is reviewing study alignment...
                    </>
                  ) : (
                    <>
                      <span>🧠</span>
                      Execute Live Gemini Biocurator Report
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* json payload output */}
          <div className="glass-panel" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>📁</span>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Graph Node Evidentiary Record Preview</h3>
              </div>
              <button 
                onClick={copyToClipboard}
                style={{
                  background: copied ? 'var(--accent-success)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: copied ? '#fff' : 'var(--text-primary)',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  transition: 'var(--transition-smooth)'
                }}
              >
                {copied ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Copy JSON
                  </>
                )}
              </button>
            </div>

            <div style={{ flex: 1, position: 'relative' }}>
              <pre style={{
                maxHeight: '380px',
                overflow: 'auto',
                padding: '1rem',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '6px',
                fontSize: '0.8rem',
                color: '#a7f3d0',
                lineHeight: '1.5',
                margin: 0
              }}>
                {JSON.stringify(compiledGraph, null, 4)}
              </pre>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Live Run UUID: {provenance?.run_id}</span>
              <span>Timestamp: {provenance?.timestamp}</span>
            </div>
          </div>

        </div>

      </main>

      {/* FOOTER */}
      <footer style={{ marginTop: '4rem', borderTop: '1px solid var(--border-glass)', paddingTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        TraitGraph Curation Playground • Real-time Deterministic Client Engine • Hackathon Presentation Grade
      </footer>

    </div>
  );
}
