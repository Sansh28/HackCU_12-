# Savant Extension

This Chrome extension adds a Savant side panel for research pages and builds a concept tree from the current paper context.

## Supported Sites

- ResearchGate
- arXiv
- Semantic Scholar
- OpenReview
- NCBI
- IEEE Xplore
- ACM Digital Library
- Springer

## What It Does

- Extracts paper text from the active tab
- Calls the local Savant backend for graph extraction and use-case generation
- Displays a concept graph and summarized paper use cases in a side panel
- Falls back to a locally generated context graph if backend graph generation fails

## Requirements

- Node.js 20+
- npm
- Savant backend running and reachable from the configured API base URL
- Google Chrome or another Chromium browser with extension developer mode

## Environment

Copy `.env.example` to `.env` to override the backend URL used at build time.

- `VITE_SAVANT_API_BASE_URL` defaults to `http://127.0.0.1:8000`

## Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm install
npm run build
```

Load the unpacked extension from `dist/` in `chrome://extensions`.

## Available Scripts

- `npm run dev` starts Vite in development mode
- `npm run build` builds the extension into `dist/`
- `npm run typecheck` checks TypeScript types

## Key Files

```text
src/background.ts       Extension background service worker
src/sidepanel/App.tsx   Side panel UI
public/manifest.json    Extension manifest
```

## Notes

- The manifest includes localhost backend permissions plus the supported research domains above
- The side panel is enabled only on supported research domains
