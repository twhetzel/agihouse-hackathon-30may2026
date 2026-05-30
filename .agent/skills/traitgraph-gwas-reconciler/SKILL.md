---
name: traitgraph-gwas-reconciler
description: Reconciles messy pre-publication GWAS summary statistics metadata with published GWAS Catalog-style records, grounds reported traits with ontology lookup, and emits provenance-rich graph-ready JSON.
---

# TraitGraph GWAS Reconciler Skill

## Goal

Reconcile messy GWAS pre-publication metadata with curated published records and produce ontology-grounded, provenance-rich graph-ready output.

## When to use this skill

Use this skill when the user asks to:
- reconcile GWAS summary statistics metadata
- match pre-publication GWAS records to published records
- normalize reported traits using ontology lookup
- generate a GWAS evidence graph record
- create KG-ready JSON from GWAS metadata

## Workflow

1. Read the input GWAS metadata from the user or from an example file.
2. Extract:
   - title
   - authors
   - reported trait text
   - preprint DOI or placeholder ID
   - PMID or DOI if present
   - summary statistics filename/accession if present
   - cohort/sample notes
3. Compare the input against available catalog-style records.
4. Estimate whether the input and catalog record represent the same study.
5. Normalize the reported trait text to ontology terms using the available OLS lookup or local mock lookup.
6. Emit graph-ready JSON with:
   - original pre-publication metadata
   - matched published/catalog record
   - normalized trait term
   - provenance
   - reconciliation confidence
   - review flags

## Constraints

- Do not invent PMIDs, GCST accessions, ontology IDs, or publication metadata.
- If a mapping is uncertain, mark it as `manual_review_required`.
- Preserve original submitted trait text exactly.
- Prefer transparent evidence over polished narrative.
- Produce JSON that can be consumed by downstream graph/KG tools.

## Run and Verification

To run the local deterministic reconciliation pipeline:
```bash
python3 .agent/skills/traitgraph-gwas-reconciler/scripts/reconcile_gwas.py
```

### Outputs
- Emits graph-ready JSON to [traitgraph_reconciled_asthma_graph.json](file:///Users/whetzel/git/agihouse-hackathon-30may2026/outputs/traitgraph_reconciled_asthma_graph.json)
- Displays console summary detailing study match similarity scores, normalized trait ontology, and curator review flags.