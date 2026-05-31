# TraitGraph Curation Playground

React + Vite dashboard for interactive GWAS metadata reconciliation. It mirrors the Python deterministic engine in the browser, adds optional live verification (OpenAlex, Europe PMC, OLS), and supports an optional Gemini biocurator report.

Project overview, architecture, and CLI usage: [../README.md](../README.md).

## Prerequisites

- Node.js 18+
- Network access for live literature and OLS calls (no API keys required for those)
- Optional: Gemini API key for the biocurator layer

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/).

### Optional: Gemini API key

Create `.env.local` in this directory (git-ignored):

```bash
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

Restart the dev server after changing env vars.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |

## How it loads data

Vite is configured to read files from the repo root (`vite.config.js` → `server.fs.allow`). The app imports:

- `../examples/*.json` — preset pre-publication scenarios
- `../resources/traitgraph_mock_catalog_records.json` — mock GWAS catalog

Regenerating `outputs/` via the Python CLI is not required for the web app.

## Key source files

| File | Role |
|------|------|
| `src/App.jsx` | UI, in-browser reconciliation, presets, review flags |
| `src/liveApis.js` | OpenAlex, Europe PMC, OLS live calls |
| `src/gemini.js` | Optional Gemini 2.5 Flash biocurator report |

Deterministic match scores and mock-catalog IDs remain the source of truth; live API and Gemini results are supplementary and labeled as unverified where applicable.
