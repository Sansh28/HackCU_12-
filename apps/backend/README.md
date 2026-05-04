# Backend

This app contains the FastAPI backend for Savant.

## Purpose

- PDF ingestion
- document metadata and chunk storage separation
- background job pipeline for ingestion and graph generation
- MongoDB persistence
- retrieval and question answering
- graph generation
- optional Solana payment verification
- optional ElevenLabs audio generation
- backend-issued signed auth sessions

## Run

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn savant_backend.main:app --app-dir src --host 127.0.0.1 --port 8000 --reload
```

## Health And Readiness

- `GET /healthz`: process-level liveness check
- `GET /readyz`: dependency/config readiness check for MongoDB, Gemini, and payment-wallet requirements

The backend now emits structured JSON logs that include request IDs, request paths,
request methods, upstream failure details, fallback activity, and operation durations.

## Auth And Jobs

- `POST /auth/session`: issues a signed bearer token for the client session
- `POST /upload`: queues a background document-ingestion job
- `GET /jobs/{job_id}`: polls background job status
- `GET /documents/{doc_id}`: returns document lifecycle metadata
- `POST /documents/{doc_id}/graph`: queues graph generation for an uploaded paper
- `GET /documents/{doc_id}/graph`: returns graph cache state for the document

The backend no longer trusts arbitrary client-provided owner strings. Protected routes
require a backend-issued bearer token, and authenticated requests are rate limited.

## Structure

- `src/savant_backend`: backend package
- `tests`: backend tests
- `README_SETUP.md`: extra setup notes
