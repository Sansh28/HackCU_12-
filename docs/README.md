# Docs

This folder contains repository-level documentation for Savant.

- `ARCHITECTURE.md`: structural overview and refactor guidance
- `WORKFLOW.md`: concise visual workflow
- `DETAILED_WORKFLOW.md`: onboarding-oriented step-by-step flow
- `ROADMAP.md`: phased implementation roadmap and improvement plan

Canonical references:

- development entry points live in `apps/backend`, `apps/frontend`, and `apps/extension`
- the only supported Vercel deployment root is `apps/frontend`
- the current delivery order and landed roadmap items are tracked in `ROADMAP.md`
- the upload -> session -> query -> graph smoke path is validated in CI via `apps/backend/tests/test_api_flows.py`
