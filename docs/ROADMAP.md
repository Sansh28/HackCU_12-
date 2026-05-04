# Savant Roadmap

This roadmap turns the current audit and improvement ideas into a practical
execution plan. It is organized into three phases so the team can improve
reliability first, then harden the architecture, then polish the product.

The project already has these core capabilities and this roadmap does not
repeat them as "new features":

- PDF upload and chunk ingestion
- retrieval-backed chat with citations
- session creation and conversation persistence
- graph extraction and use-case generation
- Chrome side panel paper context extraction
- optional voice playback and optional Solana payment gating

## Phase 1: Quick Wins

Goal: reduce obvious delivery risk, improve developer confidence, and tighten
the user experience without major structural rewrites.

### 1. Real frontend and extension test coverage

Current state:
- backend has meaningful tests in `apps/backend/tests/`
- frontend and extension still have placeholder test files

Target files:
- `apps/frontend/tests/components/SavantTerminal.test.tsx`
- `apps/frontend/tests/app/page.test.tsx`
- `apps/frontend/tests/lib/api.test.ts`
- `apps/extension/tests/sidepanel/App.test.tsx`
- `apps/extension/tests/background.test.ts`
- `apps/extension/tests/shared/config.test.ts`

Tasks:
- replace placeholder exports with actual component and behavior tests
- test upload-state transitions, query submission, and conversation switching
- test extension message flow and fallback rendering states
- test owner header injection in `apps/frontend/src/lib/api.ts`

Exit criteria:
- frontend tests run in CI
- extension tests run in CI
- placeholders no longer exist in tracked test files

### 2. Deployment and CI cleanup

Current state:
- root deployment shims exist for Vercel compatibility
- CI validates build and typecheck, but deployment flow is still fragile

Target files:
- `.github/workflows/ci.yml`
- `package.json`
- `vercel.json`
- `savant-frontend/package.json`
- `README.md`

Tasks:
- verify a single intended Vercel deployment path and document it
- remove compatibility shims once Vercel project settings are stable
- document which project root is canonical
- add a CI smoke check for deployment assumptions

Exit criteria:
- one documented deployment path
- no ambiguous frontend deployment wrapper left unless still required
- CI and preview deployments are reproducible from docs

### 3. Backend health, readiness, and logging

Current state:
- API exposes `/` but no dedicated health or readiness endpoints
- errors are returned, but structured logs and request tracing are missing

Target files:
- `apps/backend/src/savant_backend/main.py`
- `apps/backend/src/savant_backend/config.py`
- `apps/backend/src/savant_backend/services/backend_services.py`

Tasks:
- add `healthz` and `readyz` routes
- add request IDs and structured log output
- log model fallback mode, retrieval mode, and upstream failures consistently

Exit criteria:
- health endpoints exist and are documented
- major backend operations emit structured logs
- support/debugging no longer depends on reading ad hoc terminal output

### 4. UX improvements without architecture changes

Current state:
- terminal flow is expressive, but status is mostly communicated as log lines

Target files:
- `apps/frontend/src/components/SavantTerminal.tsx`
- `apps/frontend/src/components/terminal/TimelinePanel.tsx`
- `apps/frontend/src/components/terminal/InsightsPanel.tsx`
- `apps/frontend/src/components/terminal/QueryComposer.tsx`

Tasks:
- show clearer staged progress for upload, retrieval, synthesis, and audio
- surface fallback state more explicitly when lexical-only or local-answer mode is used
- make citation evidence easier to inspect from the chat surface

Exit criteria:
- users can tell whether the system is uploading, retrieving, generating, or degrading
- fallback paths are visible rather than hidden in telemetry

## Phase 2: Architecture Hardening

Goal: make the codebase safer to extend, cheaper to operate, and easier to
reason about under load.

### 1. Separate document metadata from chunk storage

Current state:
- chunk records carry both paper metadata and retrieval content
- document context is reconstructed from chunk collections

Target files:
- `apps/backend/src/savant_backend/routers/documents.py`
- `apps/backend/src/savant_backend/store.py`
- `apps/backend/src/savant_backend/models.py`

Tasks:
- introduce a dedicated documents collection
- store ingestion status, page count, filename, and summary metadata separately
- keep chunk storage focused on retrieval data
- prepare indexes for owner, doc, and session access patterns

Exit criteria:
- document lifecycle can be queried without scanning chunk records
- document status and graph cache can be stored cleanly

### 2. Background job pipeline for heavy operations

Current state:
- upload, embedding, graph generation, and TTS are all request-path work

Target files:
- `apps/backend/src/savant_backend/routers/documents.py`
- `apps/backend/src/savant_backend/services/backend_services.py`
- `apps/frontend/src/app/page.tsx`
- `apps/frontend/src/components/SavantTerminal.tsx`

Tasks:
- move ingestion and graph generation to background jobs
- return job IDs or document statuses to the frontend
- poll or stream progress updates
- allow retries for failed ingestion or graph generation jobs

Exit criteria:
- uploads do not require one long blocking request
- graph generation can be resumed or retried without user confusion

### 3. Real authentication and stronger ownership guarantees

Current state:
- ownership is enforced via a client-generated header

Target files:
- `apps/backend/src/savant_backend/security.py`
- `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/lib/owner.ts`
- `apps/extension/src/shared/config.ts`

Tasks:
- replace ad hoc owner tokens with real auth
- issue user identity from a trusted backend or auth provider
- tie document, session, and conversation ownership to verified identity
- add rate limiting and stronger abuse controls

Exit criteria:
- the backend no longer trusts arbitrary owner strings from clients
- access control is enforceable across frontend and extension flows

### 4. Stronger configuration and dependency boundaries

Current state:
- env vars are read directly
- dependency footprint is heavier than the active runtime path needs

Target files:
- `apps/backend/src/savant_backend/config.py`
- `apps/backend/requirements.txt`
- `apps/backend/requirements-ci.txt`
- `apps/extension/package.json`
- `apps/frontend/package.json`

Tasks:
- move backend config to typed settings validation
- fail fast on missing required configuration
- audit heavy or unused packages and remove what is not part of the runtime path
- separate local-dev, runtime, and CI dependency groups more clearly

Exit criteria:
- invalid env state fails early and clearly
- backend deploy/install time is lower and easier to reason about

## Phase 3: Product Polish

Goal: turn the current strong prototype into a more memorable and trustworthy
research product.

### 1. Better evidence and explainability UX

Status:
- in progress
- landed: citation reason strings, match-term inspection, and clearer fallback explainability surfaces

Current state:
- citations and telemetry exist, but evidence inspection is still lightweight

Target files:
- `apps/frontend/src/components/terminal/InsightsPanel.tsx`
- `apps/frontend/src/components/terminal/TimelinePanel.tsx`
- `apps/frontend/src/components/PaperGraphExplorer.tsx`

Tasks:
- show why a chunk was selected
- let users inspect citation snippets and page references more naturally
- explain when the answer came from lexical fallback or local synthesis

Exit criteria:
- users can tell why they got a specific answer
- citation exploration feels like part of the main workflow, not a side detail

### 2. Richer graph workflow

Status:
- in progress
- landed: graph artifacts are persisted by `doc_id`, and graph workspaces now retain bookmarks, node notes, selected nodes, and saved insights

Current state:
- graph generation exists and graph Q&A exists
- graph state is still largely ephemeral

Target files:
- `apps/frontend/src/app/page.tsx`
- `apps/frontend/src/components/PaperGraphExplorer.tsx`
- `apps/backend/src/savant_backend/routers/graph.py`

Tasks:
- persist graph artifacts by `doc_id`
- support revisiting and resuming graph sessions more explicitly
- allow saved insights, bookmarks, or node-level notes

Exit criteria:
- users can return to a paper graph without paying regeneration cost each time
- graph exploration feels like a first-class workflow, not an accessory view

### 3. Extension site adapters

Status:
- in progress
- landed: adapter-aware extraction metadata and supported-site strategy reporting in the side panel

Current state:
- the extension uses a broad DOM extraction strategy with a fallback graph path

Target files:
- `apps/extension/src/background.ts`
- `apps/extension/src/shared/types.ts`
- `apps/extension/src/sidepanel/App.tsx`

Tasks:
- add per-site extraction adapters for arXiv, OpenReview, ACM, IEEE, Springer, and Semantic Scholar
- show which extraction strategy was used
- expose extraction confidence or fallback state to the user

Exit criteria:
- context extraction is more reliable on supported sites
- debugging extraction failures no longer requires manual guessing

### 4. End-to-end quality and contributor experience

Status:
- in progress
- landed: backend smoke coverage now includes upload -> session -> query -> graph workspace flow in CI

Current state:
- docs exist, but there is no single delivery roadmap in the repo
- cross-app smoke coverage is still light

Target files:
- `.github/workflows/ci.yml`
- `docs/README.md`
- `README.md`
- `AGENTS.md`

Tasks:
- add one end-to-end upload -> session -> query -> graph smoke suite
- keep this roadmap updated as items land
- document canonical development and deployment paths in one place

Exit criteria:
- contributors can see what is next without reverse-engineering open issues
- regressions across backend/frontend/extension boundaries are caught earlier

## Suggested Order

1. Phase 1.1 test coverage
2. Phase 1.2 deployment cleanup
3. Phase 1.3 backend health/logging
4. Phase 1.4 terminal UX feedback
5. Phase 2.1 document model split
6. Phase 2.2 background jobs
7. Phase 2.3 real auth
8. Phase 2.4 config and dependency cleanup
9. Phase 3.1 explainability UX
10. Phase 3.2 richer graph workflow
11. Phase 3.3 extension adapters
12. Phase 3.4 end-to-end polish

## Definition of Done

The roadmap is successful when:

- core user flows are tested across apps
- deployment is boring and reproducible
- auth and ownership are trustworthy
- heavy work is no longer blocking user requests
- evidence, graphs, and extension extraction are easier to trust
