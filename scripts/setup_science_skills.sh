#!/usr/bin/env bash
# Vendor Google Science Skills (literature search subset) for GWAS PrePubMatch.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/.agent/skills/_vendor/science-skills"

mkdir -p "$ROOT/.agent/skills/_vendor"
cd "$ROOT/.agent/skills/_vendor"

if [[ -d science-skills/.git ]]; then
  echo "Science skills already cloned; updating sparse checkout..."
  cd science-skills
  git pull --ff-only origin main 2>/dev/null || true
else
  git clone --depth 1 --filter=blob:none --sparse https://github.com/google-deepmind/science-skills.git science-skills
  cd science-skills
fi

git sparse-checkout set \
  skills/literature_search_openalex \
  skills/literature_search_europepmc \
  skills/literature_search_biorxiv \
  skills/pubmed_database \
  skills/scienceskillscommon \
  skills/uv

echo "Science Skills installed at $VENDOR"
echo "Optional: add OPENALEX_API_KEY and NCBI_API_KEY to ~/.env for higher rate limits."
