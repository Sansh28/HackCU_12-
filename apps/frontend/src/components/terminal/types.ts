export type Citation = {
  filename?: string;
  page_number?: number;
  chunk_index?: number;
  score?: number;
  snippet?: string;
};

export type QueryTelemetry = {
  embed_ms?: number;
  retrieval_ms?: number;
  llm_ms?: number;
  tts_ms?: number;
  payment_verify_ms?: number;
  total_ms?: number;
};

export type DocMeta = {
  chunksProcessed?: number;
  chunksStored?: number;
  pageCount?: number;
  ingestMs?: number;
};

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  docId: string | null;
  fileName: string | null;
  sessionId: string | null;
  logs: string[];
  citations: Citation[];
  telemetry: QueryTelemetry | null;
  docMeta: DocMeta | null;
};

export type GraphStatus = "idle" | "loading" | "ready" | "error";

export type TimelineItem = {
  id: string;
  raw: string;
  tone: "info" | "success" | "warn" | "error";
};
