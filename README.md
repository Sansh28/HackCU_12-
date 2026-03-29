# Savant

Savant is a research assistant platform built during HackCU that helps users explore papers through three connected surfaces:

- A FastAPI backend for PDF ingestion, retrieval, graph generation, and session storage
- A Next.js frontend for document chat, voice interaction, citations, and graph exploration
- A Chrome side panel extension for generating concept trees from research pages

## Repository Structure

```text
HackCU_12--main/
|- savant-backend/     FastAPI API, PDF ingestion, retrieval, graph endpoints
|- savant-frontend/    Next.js research cockpit UI
|- savant-extension/   Chrome side panel extension for paper context trees
|- .gitignore
```

## Core Features

- Upload PDF papers and chunk them page by page
- Store document chunks in MongoDB Atlas with vector search support
- Query papers with Gemini-backed answers plus lexical fallback
- Generate concept graphs and paper use cases from document context
- Save chat sessions and share them across users
- Optional Solana payment gating before query execution
- Voice input plus ElevenLabs or browser TTS playback
- Chrome extension support for ResearchGate, arXiv, and Semantic Scholar

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind CSS
- Backend: FastAPI, Motor, PyPDF2, Gemini API, ElevenLabs
- Extension: Vite, React, TypeScript, Chrome Extensions Manifest V3
- Data: MongoDB Atlas vector search

## Prerequisites

- Node.js 20+
- npm
- Python 3.10+
- MongoDB Atlas database
- Gemini API key
- ElevenLabs API key for audio output
- Solana wallet and RPC endpoint if payment gating is enabled

## Environment Setup

### 1. Backend

Copy `savant-backend/.env.example` to `savant-backend/.env` and fill in the values.

Required backend variables:

- `MONGODB_URI`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `SOLANA_RPC_URL`
- `MASTER_WALLET`
- `QUERY_PRICE_SOL`
- `REQUIRE_SOLANA_PAYMENT`
- `CORS_ALLOW_ORIGINS`

### 2. Frontend

Copy `savant-frontend/.env.example` to `savant-frontend/.env.local`.

Required frontend variables:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_MASTER_WALLET`
- `NEXT_PUBLIC_QUERY_PRICE_SOL`
- `NEXT_PUBLIC_REQUIRE_SOLANA_PAYMENT`

### 3. Extension

Copy `savant-extension/.env.example` to `savant-extension/.env` to override the backend URL used by the extension build.

Extension variable:

- `VITE_SAVANT_API_BASE_URL`

## MongoDB Atlas Vector Index

Create a vector index on `savant.documents` named `vector_index`:

```json
{
  "fields": [
    {
      "numDimensions": 768,
      "path": "embedding",
      "similarity": "cosine",
      "type": "vector"
    }
  ]
}
```

## Local Development

### Backend

```bash
cd savant-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```bash
cd savant-frontend
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

### Chrome Extension

```bash
cd savant-extension
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer Mode, choose `Load unpacked`, and select the generated `savant-extension/dist` folder.

## Suggested Run Order

1. Start the backend
2. Start the frontend
3. Build and load the Chrome extension
4. Upload a PDF in the web app or open a supported paper page for the extension

## GitHub Readiness Checklist

- Root documentation added
- Frontend environment template added
- Frontend and extension documentation added
- Existing `.gitignore` already covers common Python, Node, build, and secret files

## Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

If this folder is already inside another Git repository, create the GitHub remote from that existing repo root instead of running `git init` again.

## Notes

- `savant-frontend/README.md` now contains app-specific frontend setup details
- `savant-extension/README.md` documents how to build and load the browser extension
- No license file was added because license choice is a product decision and should match how you want others to use the code
