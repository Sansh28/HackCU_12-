# Backend

This app contains the FastAPI backend for Savant.

## Purpose

- PDF ingestion
- chunking and embedding
- MongoDB persistence
- retrieval and question answering
- graph generation
- optional Solana payment verification
- optional ElevenLabs audio generation

## Run

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn savant_backend.main:app --app-dir src --host 127.0.0.1 --port 8000 --reload
```

## Structure

- `src/savant_backend`: backend package
- `tests`: backend tests
- `README_SETUP.md`: extra setup notes
