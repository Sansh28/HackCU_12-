# AGENTS

## Overview

Savant is organized as a small monorepo:

- `apps/backend`: FastAPI API for ingestion, retrieval, graph generation, and persistence
- `apps/frontend`: Next.js web UI for upload, chat, voice, and graph exploration
- `apps/extension`: Chrome side-panel extension for supported research websites
- `docs`: architecture and workflow documentation

## Setup Commands

### Backend

```bash
cd apps/backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn savant_backend.main:app --app-dir src --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```bash
cd apps/frontend
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

### Extension

```bash
cd apps/extension
npm install
npm run build
```

## Folder Map

- `apps/backend/src/savant_backend/routers`: HTTP route handlers
- `apps/backend/src/savant_backend/services`: backend service logic
- `apps/backend/tests`: backend tests
- `apps/frontend/src/app`: Next.js app router files
- `apps/frontend/src/components`: frontend UI components
- `apps/frontend/src/lib`: frontend client utilities
- `apps/extension/src`: extension background worker and side-panel code
- `docs`: repo-level docs

## Code Style

- Preserve business logic during structural refactors
- Prefer package-local imports in backend code
- Keep frontend and extension code TypeScript-first
- Avoid hardcoded secrets; use env variables and placeholders
- Keep generated artifacts out of version control

## Test Commands

### Backend

```bash
cd apps/backend
python -m unittest discover -s tests -p "test*.py"
```

### Frontend

```bash
cd apps/frontend
npm run lint
npm exec tsc -- --noEmit
```

### Extension

```bash
cd apps/extension
npm run typecheck
npm run build
```
