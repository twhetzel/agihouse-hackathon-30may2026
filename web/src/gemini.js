import { GoogleGenAI } from '@google/genai';

/**
 * Executes a call to the Gemini API (using gemini-2.5-flash) to obtain a live, AI-augmented
 * biocurator report. Matches the exact structured JSON schema requested by the user.
 * 
 * @param {Object} params
 * @param {string} params.apiKey - The Gemini API Key
 * @param {Object} params.inputMetadata - Messy pre-publication metadata
 * @param {Object|null} params.matchedRecord - Best matched catalog record (or null)
 * @param {Object} params.verification - Calculated matching verifications
 * @param {Object} params.localScores - Detailed Jaccard/Author/File similarity scores
 * @returns {Promise<Object>} The parsed structured curator report from Gemini
 */
export async function generateBiocuratorReport({ apiKey, inputMetadata, matchedRecord, verification, localScores }) {
  if (!apiKey) {
    throw new Error("Missing Gemini API Key. Please provide your API Key in the settings bar at the top of the page.");
  }

  // Initialize the official Google GenAI SDK
  const ai = new GoogleGenAI({ apiKey });

  // Structure a rich biocurator prompt feeding raw details
  const prompt = `You are a high-performance biomedical curator for the GWAS Catalog and Knowledge Graph ingestion pipelines.
Your job is to analyze the matching results computed by our local, deterministic verification engine and generate an AI biocurator curation insight layer.

### CONSTRAINTS (MUST FOLLOW STRICTLY):
1. NEVER invent or hallucinate PubMed PMIDs, GCST accession numbers, or verified EFO/MONDO ontology IDs.
2. Any ontology IDs you suggest must be marked with the status "ai_suggested_not_verified".
3. If there is insufficient evidence to determine a match or resolve an ontology term, explicitly state so in the uncertainty notes.
4. The local, deterministic verifier's confidence score remains the absolute source of truth for the match status; your insights are an optional curation audit layer.

### DATA INPUTS:

1. Messy Pre-Publication Metadata:
${JSON.stringify(inputMetadata, null, 2)}

2. Best Reconciled Curated Catalog Study Match:
${matchedRecord ? JSON.stringify(matchedRecord, null, 2) : "NONE (No catalog record matched the minimum threshold)"}

3. Local Verification Metrics:
- Reconciliation Confidence: ${(verification?.confidence_score * 100).toFixed(2)}%
- Jaccard Title Similarity: ${(localScores?.title_similarity * 100).toFixed(0)}%
- Author Overlap Similarity: ${(localScores?.author_similarity * 100).toFixed(0)}%
- File Match Similarity: ${(localScores?.file_similarity * 100).toFixed(0)}%
- Grounded Trait: ${verification?.normalized_trait?.ontology_label || "None"} (${verification?.normalized_trait?.ontology_id || "None"})
- Curation Action Required: ${verification?.review_flags?.manual_review_required ? "YES" : "NO"}
- Local Review Reasons: ${JSON.stringify(verification?.review_flags?.reasons || [])}

### SYSTEM INSTRUCTIONS:
- Analyze the title and author overlaps semantically. Explain why Jaccard similarity is high or low (e.g. synonym phrasings, spelling deviations, minor author accents).
- Perform Ontology Decomposition: Analyze the reported trait. If it contains multiple phenotypes separated by slashes (/), commas, or "and", split them into individual concepts. Recommend suitable standard ontology IDs if you know them (or null if you don't) and mark their status as "ai_suggested_not_verified". Provide a solid, scientific rationale for the mapping.
- Reroute to a curator recommendation:
  * "auto_merge" (only if local match confidence is >= 70% and grounding is exact).
  * "curator_review" (if there is mild Jaccard mismatch, compound traits, or synonyms).
  * "do_not_merge" (if cohort or study details are entirely different).
- Document all uncertainties and missing evidence as an array of notes.

You must respond in strict JSON matching the following schema structure:
{
  "semantic_study_match_analysis": "string detailing Jaccard matching analysis and synonym comparisons",
  "ontology_decomposition": [
    {
      "concept": "string (decomposed concept name)",
      "suggested_id": "string or null (e.g. 'MONDO:0004979' or 'EFO:0003006')",
      "suggestion_status": "ai_suggested_not_verified",
      "reasoning": "string detailing biocurator mapping rationale"
    }
  ],
  "curator_recommendation": "auto_merge" | "curator_review" | "do_not_merge",
  "uncertainty_notes": ["string"]
}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            semantic_study_match_analysis: { type: 'STRING' },
            ontology_decomposition: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  concept: { type: 'STRING' },
                  suggested_id: { type: 'STRING', nullable: true },
                  suggestion_status: { type: 'STRING' },
                  reasoning: { type: 'STRING' }
                },
                required: ['concept', 'suggested_id', 'suggestion_status', 'reasoning']
              }
            },
            curator_recommendation: { 
              type: 'STRING',
              enum: ['auto_merge', 'curator_review', 'do_not_merge']
            },
            uncertainty_notes: {
              type: 'ARRAY',
              items: { type: 'STRING' }
            }
          },
          required: ['semantic_study_match_analysis', 'ontology_decomposition', 'curator_recommendation', 'uncertainty_notes']
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini.");
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini API curation analysis failed:", error);
    throw new Error(`Gemini Curation Pipeline failed: ${error.message || error}`);
  }
}
