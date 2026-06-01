# GWAS PrePubMatch Dashboard

React + Vite UI for unified GWAS discovery. Paste pre-publication submission metadata (title, authors, trait, GCST/DOI clues) and get ranked **GWAS Catalog studies** (including pre-pub sumstats) and **publications** from OpenAlex, Europe PMC, and PubMed — with transparent match scoring.

The dashboard talks to the FastAPI orchestrator at `/api/*`; it does not call external APIs directly.

---

## Prerequisites

Start the discovery API **before** the web dev server (from the repo root):

```bash
# Recommended: install Google Science Skills for primary literature search
bash scripts/setup_science_skills.sh

# Optional: copy .env.example → .env for API keys / cache tuning
cp .env.example .env

bash scripts/run_server.sh
```

Verify the API: `curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool`

Full server setup, Docker, and API reference: [project README](../README.md).

---

## Development

```bash
cd web
npm install
npm run dev
```

Open **[http://localhost:5173/](http://localhost:5173/)**.

Vite proxies `/api` to `http://127.0.0.1:8000`, so no frontend env vars are required for local dev. The header badge shows API status (`Online` / `Degraded` / `Offline`), schema version, and whether Science Skills or HTTP fallback is in use.

### Other scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Production static build → `dist/` |
| `npm run preview` | Serve `dist/` locally (port 4173; add to `PREPUBMATCH_CORS_ORIGINS` if calling API cross-origin) |
| `npm run lint` | ESLint |

---

## Using the dashboard

1. **Load a scenario preset** — four examples from `examples/` fill the metadata form and **auto-run discovery**:
   - **Probable Match** (default) — draft asthma GWAS submission
   - **High Confidence** — near-identical Pividori asthma metadata
   - **Ambiguous Trait** — compound trait string (wheeze/asthma/allergy)
   - **Different Cohort** — similar title, different authors

2. **Edit fields** — title, authors, reported trait, summary-stats filename, GCST, DOI, cohort, notes. At least one of title, trait, DOI, or GCST is needed for good results.

3. **Discover Related Studies** — click after editing (button highlights when there are pending changes). Preset selection runs discovery automatically; manual edits require this button.

4. **Review results** — unified ranked hits, top-match verification links (PubMed, GWAS Catalog, DOI), and supplementary pre-pub sumstats panel.

**Client-side only:** the “Reported Trait (Ontology Grounder)” field runs a local MONDO/EFO demo mapper in the browser; match scores and discovery hits come from the API.

---

## Production (Docker)

From the repo root:

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL |
|---------|-----|
| API | http://localhost:8000/api/health |
| UI (nginx + `/api` proxy) | http://localhost:8080 |

The `web` image is built with `Dockerfile.web`; nginx config is in `deploy/nginx.conf`.

---

## Project layout

```
web/
├── src/
│   ├── App.jsx              # Metadata form, presets, theme, discovery trigger
│   ├── discoverApi.js       # /api/health and /api/discover client
│   ├── DiscoveryResults.jsx # Ranked results, verification panel
│   └── theme.js             # Light/dark theme (localStorage)
├── vite.config.js           # Dev proxy /api → :8000; fs allow for examples/
└── index.html
```

Example submission JSON lives in `../examples/` and is imported at build time.
