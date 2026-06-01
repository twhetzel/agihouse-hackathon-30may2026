---
name: gwas-prepubmatch
description: Connect pre-publication GWAS summary-stat submission metadata to published literature using Google Science Skills and return ranked related publications.
---

# GWAS PrePubMatch Skill

## Goal

Connect pre-publication GWAS summary-stat submission metadata to published literature using Google Science Skills and return ranked related publications.

## When to use this skill

Use when the user asks to:
- find the published paper behind a GWAS pre-publication submission
- search literature for pre-publication GWAS metadata
- link GWAS submission titles/authors to OpenAlex, Europe PMC, or PubMed
- discover related publications for meta-analysis

## Workflow

1. Read submission metadata (title, authors, reported trait).
2. Run `POST /api/discover` on the local GWAS PrePubMatch server (or `server/traitgraph_server/discover.py` directly).
3. Review `discovery_summary`, `publication_results`, and `catalog_study_results` in the web UI or API JSON.

## Run

```bash
# Terminal 1: API server
cd server && uv run uvicorn traitgraph_server.main:app --port 8000

# Terminal 2: discover via curl
curl -s -X POST http://127.0.0.1:8000/api/discover \
  -H 'Content-Type: application/json' \
  -d @examples/traitgraph_messy_asthma_prepub.json
```

## Constraints

- Do not invent PMIDs, DOIs, or GCST accessions.
- Science Skills and GWAS Catalog Solr provide deterministic ranked results; do not invent identifiers.
