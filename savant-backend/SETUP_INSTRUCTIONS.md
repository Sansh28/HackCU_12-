# Savant Setup Instructions

## 1. Environment Variables
Create a `.env` file in both `/savant-frontend` and `/savant-backend` using each `.env.example`.

### Backend required
- `MONGODB_URI`
- `GEMINI_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `SOLANA_RPC_URL`
- `MASTER_WALLET`
- `QUERY_PRICE_SOL`
- `REQUIRE_SOLANA_PAYMENT`
- `CORS_ALLOW_ORIGINS`

### Frontend required
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_MASTER_WALLET`
- `NEXT_PUBLIC_QUERY_PRICE_SOL`
- `NEXT_PUBLIC_REQUIRE_SOLANA_PAYMENT`

## 2. MongoDB Atlas Vector Search Setup
For backend retrieval, create the index on `savant.documents`:

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

Name the index: `vector_index`.

## 3. Start Services
### Backend
```bash
cd savant-backend
venv\Scripts\activate
uvicorn main:app --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd savant-frontend
npm run dev -- --hostname 127.0.0.1 --port 3000
```

## 4. Feature Checklist
- PDF upload and ingestion with page-aware chunking
- Hybrid retrieval (vector + lexical fallback)
- Citation output with page/chunk snippets
- Optional Solana payment gating before each query
- Voice input + ElevenLabs audio output
- Session persistence and shareable session links
