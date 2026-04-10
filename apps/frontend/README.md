# Savant Frontend

This is the Next.js frontend for Savant, the research cockpit that lets users upload papers, ask questions, inspect citations, listen to answers, and explore AI-generated concept graphs.

## Features

- PDF upload workflow tied to backend ingestion
- Chat-style paper analysis with citations
- Voice input and audio playback
- Conversation history and session persistence
- Paper graph explorer mode for concept navigation

## Requirements

- Node.js 20+
- npm
- Running Savant backend at `NEXT_PUBLIC_API_BASE_URL`

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Set these values:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SOLANA_RPC_URL`
- `NEXT_PUBLIC_MASTER_WALLET`
- `NEXT_PUBLIC_QUERY_PRICE_SOL`
- `NEXT_PUBLIC_REQUIRE_SOLANA_PAYMENT`

## Development

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Available Scripts

- `npm run dev` starts the development server
- `npm run build` creates a production build
- `npm run start` runs the production server
- `npm run lint` runs ESLint

## Key Directories

```text
src/app/                App router entry points and global styles
src/components/         Savant terminal, graph explorer, background visuals
public/                 Static assets
```

## Notes

- The frontend expects the backend to expose upload, query, session, graph, and conversation endpoints
- If ElevenLabs audio is unavailable, the UI falls back to browser speech synthesis when possible
