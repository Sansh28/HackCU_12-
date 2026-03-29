import asyncio
import io
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from google import genai
from PyPDF2 import PdfReader
from elevenlabs.client import ElevenLabs

load_dotenv()

# Embedding: use REST directly so the model is never overridden by SDK defaults.
GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
MASTER_WALLET = os.getenv("MASTER_WALLET", "")
QUERY_PRICE_SOL = float(os.getenv("QUERY_PRICE_SOL", "0.005"))
QUERY_PRICE_LAMPORTS = int(QUERY_PRICE_SOL * 1_000_000_000)
PAYMENT_WINDOW_SECONDS = int(os.getenv("PAYMENT_WINDOW_SECONDS", "900"))
REQUIRE_SOLANA_PAYMENT = os.getenv("REQUIRE_SOLANA_PAYMENT", "false").lower() in {"1", "true", "yes"}
EMBED_MAX_RETRIES = int(os.getenv("EMBED_MAX_RETRIES", "6"))
EMBED_RETRY_BASE_SECONDS = float(os.getenv("EMBED_RETRY_BASE_SECONDS", "1.0"))
EMBED_RETRY_MAX_SECONDS = float(os.getenv("EMBED_RETRY_MAX_SECONDS", "20.0"))
EMBED_REQUEST_TIMEOUT_SECONDS = int(os.getenv("EMBED_REQUEST_TIMEOUT_SECONDS", "30"))
EMBED_MIN_INTERVAL_SECONDS = float(os.getenv("EMBED_MIN_INTERVAL_SECONDS", "0.75"))
UPLOAD_CHUNK_SIZE = int(os.getenv("UPLOAD_CHUNK_SIZE", "1400"))
UPLOAD_CHUNK_OVERLAP = int(os.getenv("UPLOAD_CHUNK_OVERLAP", "200"))
UPLOAD_MAX_CHUNKS = int(os.getenv("UPLOAD_MAX_CHUNKS", "120"))
EMBED_ALLOW_LEXICAL_FALLBACK = os.getenv("EMBED_ALLOW_LEXICAL_FALLBACK", "true").lower() in {"1", "true", "yes"}
GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_GENERATE_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GENERATE_MAX_RETRIES = int(os.getenv("GENERATE_MAX_RETRIES", "4"))
GENERATE_RETRY_BASE_SECONDS = float(os.getenv("GENERATE_RETRY_BASE_SECONDS", "1.5"))
GENERATE_RETRY_MAX_SECONDS = float(os.getenv("GENERATE_RETRY_MAX_SECONDS", "45.0"))
ALLOW_GENERATE_LOCAL_FALLBACK = os.getenv("ALLOW_GENERATE_LOCAL_FALLBACK", "true").lower() in {"1", "true", "yes"}
_LAST_EMBED_TS = 0.0
CORS_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]

app = FastAPI(title="Savant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGODB_URI = os.getenv("MONGODB_URI")
if MONGODB_URI:
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client.savant
    documents_collection = db.documents
    payments_collection = db.payments
    sessions_collection = db.sessions
    messages_collection = db.session_messages
    graph_sessions_collection = db.graph_sessions
    graph_messages_collection = db.graph_messages
    chat_conversations_collection = db.chat_conversations
else:
    print("WARNING: MONGODB_URI not set. Database operations will fail.")
    client = None

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai_client = genai.Client(api_key=GEMINI_API_KEY)
else:
    print("WARNING: GEMINI_API_KEY not set.")
    genai_client = None

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
if ELEVENLABS_API_KEY:
    elevenlabs_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
else:
    print("WARNING: ELEVENLABS_API_KEY not set.")
    elevenlabs_client = None

VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "pOvpV9R62HOnx42lX4gE")


class QueryRequest(BaseModel):
    prompt: str
    doc_id: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    session_id: str | None = None
    payment_signature: str | None = None
    payer_pubkey: str | None = None


class CreateSessionRequest(BaseModel):
    doc_id: str | None = None
    title: str | None = None


class GraphExtractRequest(BaseModel):
    paper_text: str


class GraphUseCasesRequest(BaseModel):
    paper_text: str


class GraphAskRequest(BaseModel):
    concept: str
    question: str
    paper_context: str
    history: list[dict] = Field(default_factory=list)
    session_id: str | None = None
    node_id: str | None = None


class GraphSessionCreateRequest(BaseModel):
    title: str | None = None
    paper_context: str | None = None


class UploadedPaperContextResponse(BaseModel):
    doc_id: str
    filename: str | None = None
    paper_text: str
    page_count: int
    chunk_count: int


class ChatConversationStateRequest(BaseModel):
    title: str
    doc_id: str | None = None
    file_name: str | None = None
    session_id: str | None = None
    logs: list[str] = Field(default_factory=list)
    citations: list[dict] = Field(default_factory=list)
    telemetry: dict | None = None
    doc_meta: dict | None = None


class ChatConversationRenameRequest(BaseModel):
    title: str


VALID_GRAPH_CATEGORIES = {"foundation", "method", "result", "component", "concept"}


def _extract_retry_delay_seconds(error_data: dict | None, attempt: int, base_seconds: float, max_seconds: float) -> float:
    retry_delay_s = None
    details = error_data.get("error", {}).get("details", []) if isinstance(error_data, dict) else []
    for detail in details if isinstance(details, list) else []:
        if isinstance(detail, dict) and "retryDelay" in detail:
            value = str(detail.get("retryDelay", "")).strip().lower()
            if value.endswith("s"):
                try:
                    retry_delay_s = float(value[:-1])
                except ValueError:
                    retry_delay_s = None
            break

    if retry_delay_s is None:
        return min(base_seconds * (2 ** attempt), max_seconds)
    return min(retry_delay_s, max_seconds)


async def call_gemini(contents: str, system_instruction: str | None = None, require_json: bool = False) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API not configured")

    payload: dict = {
        "contents": [{"role": "user", "parts": [{"text": contents}]}],
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    if require_json:
        payload["generationConfig"] = {"responseMimeType": "application/json"}

    last_status_code = None
    last_error_detail = None
    data = None
    
    async with httpx.AsyncClient(timeout=45) as http_client:
        for attempt in range(GENERATE_MAX_RETRIES + 1):
            try:
                response = await http_client.post(
                    f"{GEMINI_GENERATE_URL}?key={GEMINI_API_KEY}",
                    json=payload,
                )
                if response.status_code == 429:
                    last_status_code = 429
                    try:
                        error_data = response.json()
                    except ValueError:
                        error_data = {}
                    last_error_detail = error_data

                    if attempt >= GENERATE_MAX_RETRIES:
                        break

                    await asyncio.sleep(
                        _extract_retry_delay_seconds(
                            error_data,
                            attempt,
                            GENERATE_RETRY_BASE_SECONDS,
                            GENERATE_RETRY_MAX_SECONDS,
                        )
                    )
                    continue

                response.raise_for_status()
                data = response.json()
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_status_code = 429
                    if attempt >= GENERATE_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(GENERATE_RETRY_BASE_SECONDS * (2 ** attempt), GENERATE_RETRY_MAX_SECONDS))
                    continue
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc
    if last_status_code == 429 and not data:
        detail_msg = (
            "Gemini text-generation quota exceeded. Wait ~1 minute and retry, switch API key/project, "
            "or reduce query volume."
        )
        if isinstance(last_error_detail, dict):
            api_msg = str(last_error_detail.get("error", {}).get("message", "")).strip()
            if api_msg:
                detail_msg = api_msg
        raise HTTPException(status_code=429, detail=detail_msg)

    if not data:
        raise HTTPException(status_code=502, detail="Gemini returned empty response")

    candidates = data.get("candidates", [])
    if not candidates:
        raise HTTPException(status_code=502, detail="Gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text_chunks = [part.get("text", "") for part in parts if part.get("text")]
    text_output = "".join(text_chunks).strip()
    if not text_output:
        raise HTTPException(status_code=502, detail="Gemini returned empty content")
    return text_output


def _local_answer_from_context(prompt: str, context_text: str) -> str:
    if not context_text or context_text.strip() == "No relevant context found.":
        return (
            "Gemini quota is temporarily exhausted and no strong context match was found. "
            "Please retry shortly after quota resets."
        )

    tokens = [t for t in re.findall(r"[a-zA-Z0-9]+", prompt.lower()) if len(t) > 2]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", context_text) if s.strip()]
    if not sentences:
        return "Gemini quota is temporarily exhausted. Please retry shortly."

    scored = []
    for sent in sentences:
        s_low = sent.lower()
        score = sum(s_low.count(tok) for tok in tokens) if tokens else 0
        scored.append((score, sent))
    scored.sort(key=lambda x: x[0], reverse=True)

    picked = [s for _, s in scored[:3] if s]
    if not picked:
        picked = sentences[:2]

    summary = " ".join(picked)[:900]
    return (
        "Gemini quota is currently exhausted, so this is a context-only fallback answer: "
        f"{summary}"
    )


def _validate_graph_payload(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Graph payload is not a JSON object")

    title = str(payload.get("title", "Paper Concept Graph")).strip() or "Paper Concept Graph"
    raw_nodes = payload.get("nodes", [])
    raw_edges = payload.get("edges", [])
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise HTTPException(status_code=502, detail="Graph payload must include nodes[] and edges[]")

    nodes: list[dict] = []
    seen_ids: set[str] = set()
    for raw_node in raw_nodes[:16]:
        if not isinstance(raw_node, dict):
            continue
        node_id = str(raw_node.get("id", "")).strip()
        if not node_id or node_id in seen_ids:
            continue
        category = str(raw_node.get("category", "concept")).strip().lower()
        if category not in VALID_GRAPH_CATEGORIES:
            category = "concept"
        try:
            importance = int(raw_node.get("importance", 3))
        except (TypeError, ValueError):
            importance = 3
        importance = max(1, min(5, importance))

        node = {
            "id": node_id,
            "label": str(raw_node.get("label", node_id)).strip()[:80] or node_id,
            "summary": str(raw_node.get("summary", "")).strip()[:500],
            "category": category,
            "importance": importance,
        }
        nodes.append(node)
        seen_ids.add(node_id)

    if len(nodes) < 2:
        raise HTTPException(status_code=502, detail="Gemini returned too few valid nodes")

    edges: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()
    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            continue
        source = str(raw_edge.get("source", "")).strip()
        target = str(raw_edge.get("target", "")).strip()
        if source not in seen_ids or target not in seen_ids or source == target:
            continue
        label = str(raw_edge.get("label", "relates to")).strip()[:60] or "relates to"
        key = (source, target, label)
        if key in seen_edges:
            continue
        edges.append({"source": source, "target": target, "label": label})
        seen_edges.add(key)

    if not edges:
        node_ids = [node["id"] for node in nodes]
        for idx in range(len(node_ids) - 1):
            edges.append({"source": node_ids[idx], "target": node_ids[idx + 1], "label": "supports"})

    return {"title": title[:120], "nodes": nodes, "edges": _enforce_dag_edges(nodes, edges)}


def _validate_use_cases_payload(payload: dict) -> list[dict]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Use-cases payload is not a JSON object")

    raw = payload.get("use_cases", [])
    if not isinstance(raw, list):
        raise HTTPException(status_code=502, detail="Use-cases payload must include use_cases[]")

    cleaned: list[dict] = []
    seen_titles: set[str] = set()
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()[:80]
        description = str(item.get("description", "")).strip()[:320]
        if not title or not description:
            continue
        title_key = title.lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        cleaned.append({"title": title, "description": description})

    if len(cleaned) < 2:
        raise HTTPException(status_code=502, detail="Gemini returned too few valid use cases")
    return cleaned


def _would_create_cycle(graph: dict[str, list[str]], source: str, target: str) -> bool:
    """Check if adding source->target creates a cycle by searching path target=>source."""
    stack = [target]
    visited: set[str] = set()
    while stack:
        current = stack.pop()
        if current == source:
            return True
        if current in visited:
            continue
        visited.add(current)
        stack.extend(graph.get(current, []))
    return False


def _enforce_dag_edges(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Drop back-edges that would create directed cycles."""
    valid_ids = {node["id"] for node in nodes}
    graph: dict[str, list[str]] = {node_id: [] for node_id in valid_ids}
    dag_edges: list[dict] = []

    # Prefer higher-importance forward edges first for more stable DAG structure.
    importance_map = {node["id"]: int(node.get("importance", 3)) for node in nodes}
    sorted_edges = sorted(
        edges,
        key=lambda edge: (importance_map.get(edge["source"], 0), importance_map.get(edge["target"], 0)),
        reverse=True,
    )

    for edge in sorted_edges:
        source = edge["source"]
        target = edge["target"]
        if source not in valid_ids or target not in valid_ids or source == target:
            continue
        if _would_create_cycle(graph, source, target):
            continue
        graph[source].append(target)
        dag_edges.append(edge)

    return dag_edges


def extract_pages_from_pdf(pdf_bytes: bytes) -> list[dict]:
    """Extract text page-by-page from a PDF byte array."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages: list[dict] = []

    for idx, page in enumerate(reader.pages, start=1):
        page_text = (page.extract_text() or "").strip()
        if page_text:
            pages.append({"page_number": idx, "text": page_text})

    return pages


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into chunks of `chunk_size` chars with `overlap`."""
    chunks: list[str] = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk = text[start:end]
        chunks.append(chunk)
        start += chunk_size - overlap

    return chunks


async def _embed_via_rest(text: str) -> list[float]:
    global _LAST_EMBED_TS
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise Exception("Gemini API not configured")

    last_status_code = None

    async with httpx.AsyncClient(timeout=EMBED_REQUEST_TIMEOUT_SECONDS) as http_client:
        for attempt in range(EMBED_MAX_RETRIES + 1):
            try:
                if EMBED_MIN_INTERVAL_SECONDS > 0:
                    now = time.monotonic()
                    elapsed = now - _LAST_EMBED_TS
                    if elapsed < EMBED_MIN_INTERVAL_SECONDS:
                        await asyncio.sleep(EMBED_MIN_INTERVAL_SECONDS - elapsed)
                    _LAST_EMBED_TS = time.monotonic()

                response = await http_client.post(
                    f"{GEMINI_EMBED_URL}?key={api_key}",
                    json={"content": {"parts": [{"text": text}]}},
                )

                if response.status_code == 429:
                    last_status_code = 429
                    if attempt >= EMBED_MAX_RETRIES:
                        break
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            sleep_seconds = min(float(retry_after), EMBED_RETRY_MAX_SECONDS)
                        except ValueError:
                            sleep_seconds = min(EMBED_RETRY_BASE_SECONDS * (2 ** attempt), EMBED_RETRY_MAX_SECONDS)
                    else:
                        sleep_seconds = min(EMBED_RETRY_BASE_SECONDS * (2 ** attempt), EMBED_RETRY_MAX_SECONDS)
                    await asyncio.sleep(sleep_seconds)
                    continue

                response.raise_for_status()
                data = response.json()

                if "embedding" in data:
                    return data["embedding"]["values"]
                return data["embeddings"][0]["values"]
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_status_code = 429
                    if attempt >= EMBED_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(EMBED_RETRY_BASE_SECONDS * (2 ** attempt), EMBED_RETRY_MAX_SECONDS))
                    continue
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc

    if last_status_code == 429:
        raise HTTPException(
            status_code=429,
            detail=(
                "Gemini embedding rate limit reached. Please wait 1-2 minutes and retry, "
                "or reduce upload size / increase plan quota."
            ),
        )
    raise HTTPException(status_code=500, detail="Embedding request failed")


def _fallback_chunks_for_prompt(prompt: str, docs: list[dict], limit: int = 5) -> list[dict]:
    tokens = [token for token in re.findall(r"[a-zA-Z0-9]+", prompt.lower()) if len(token) > 2]
    if not tokens:
        return docs[:limit]

    scored_docs = []
    for doc in docs:
        text = str(doc.get("text", "")).lower()
        score = sum(text.count(token) for token in tokens)
        scored_docs.append((score, doc))

    scored_docs.sort(key=lambda item: item[0], reverse=True)
    positive_scored = [doc for score, doc in scored_docs if score > 0]
    if positive_scored:
        return positive_scored[:limit]
    return docs[:limit]


def _hybrid_rerank(prompt: str, candidates: list[dict], limit: int = 5) -> list[dict]:
    tokens = [token for token in re.findall(r"[a-zA-Z0-9]+", prompt.lower()) if len(token) > 2]

    ranked: list[tuple[float, dict]] = []
    for candidate in candidates:
        text = str(candidate.get("text", "")).lower()
        lexical_score = sum(text.count(token) for token in tokens)
        vector_score = float(candidate.get("score", 0))
        final_score = (vector_score * 4.0) + lexical_score
        ranked.append((final_score, candidate))

    ranked.sort(key=lambda pair: pair[0], reverse=True)

    deduped: list[dict] = []
    seen_keys: set[tuple] = set()
    for _, doc in ranked:
        key = (doc.get("doc_id"), doc.get("chunk_index"), doc.get("page_number"))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(doc)
        if len(deduped) >= limit:
            break

    return deduped


async def _verify_solana_payment(signature: str, payer_pubkey: str) -> dict:
    if not MASTER_WALLET:
        raise HTTPException(status_code=500, detail="MASTER_WALLET is not configured")

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTransaction",
        "params": [
            signature,
            {
                "encoding": "jsonParsed",
                "maxSupportedTransactionVersion": 0,
                "commitment": "confirmed",
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=20) as http_client:
            rpc_res = await http_client.post(SOLANA_RPC_URL, json=payload)
            rpc_res.raise_for_status()
            rpc_data = rpc_res.json()
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Solana RPC request failed: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Solana RPC request failed: {exc}") from exc

    tx = rpc_data.get("result")
    if not tx:
        raise HTTPException(status_code=402, detail="Payment transaction not found or not confirmed")

    if tx.get("meta", {}).get("err"):
        raise HTTPException(status_code=402, detail="Payment transaction failed")

    block_time = tx.get("blockTime")
    if block_time is not None:
        age_seconds = int(time.time()) - int(block_time)
        if age_seconds > PAYMENT_WINDOW_SECONDS:
            raise HTTPException(status_code=402, detail="Payment transaction is too old")

    instructions = tx.get("transaction", {}).get("message", {}).get("instructions", [])

    paid_lamports = 0
    for instruction in instructions:
        parsed = instruction.get("parsed")
        if not isinstance(parsed, dict):
            continue
        if parsed.get("type") != "transfer":
            continue

        info = parsed.get("info", {})
        destination = info.get("destination")
        source = info.get("source")
        lamports = int(info.get("lamports", 0))

        if destination == MASTER_WALLET and source == payer_pubkey:
            paid_lamports += lamports

    if paid_lamports < QUERY_PRICE_LAMPORTS:
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient payment. Expected {QUERY_PRICE_LAMPORTS} lamports, got {paid_lamports}.",
        )

    return {
        "signature": signature,
        "payer_pubkey": payer_pubkey,
        "destination": MASTER_WALLET,
        "paid_lamports": paid_lamports,
    }


@app.get("/")
async def root():
    return {
        "message": "Savant API is running",
        "features": {
            "payment_gating": REQUIRE_SOLANA_PAYMENT,
            "price_sol": QUERY_PRICE_SOL,
        },
    }


@app.post("/graph/extract")
async def graph_extract(request: GraphExtractRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for graph extraction")

    system_instruction = (
        "You are an expert research assistant. Return only valid JSON. "
        "Extract 8-16 key concepts from paper text and relations between them."
    )
    prompt = (
        "Extract a concise concept graph from the following paper text.\n"
        "Return ONLY JSON matching exactly this schema:\n"
        "{\n"
        '  "title": string,\n'
        '  "nodes": [\n'
        '    {"id": string, "label": string, "summary": string, "category": "foundation"|"method"|"result"|"component"|"concept", "importance": 1-5}\n'
        "  ],\n"
        '  "edges": [{"source": string, "target": string, "label": string}]\n'
        "}\n"
        "Rules:\n"
        "- 8 to 16 nodes.\n"
        "- Keep labels short and human readable.\n"
        "- Use stable ids (snake_case).\n"
        "- Edges should generally flow from foundational ideas toward outcomes.\n"
        "- Do not add markdown fences.\n\n"
        f"Paper text:\n{paper_text[:30000]}"
    )

    try:
        raw = await call_gemini(prompt, system_instruction=system_instruction, require_json=True)
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # One retry without assuming model followed MIME strictly.
        raw_retry = await call_gemini(prompt + "\n\nReturn pure JSON only.", system_instruction=system_instruction, require_json=True)
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for graph extraction") from exc
    return _validate_graph_payload(parsed)


@app.post("/graph/use-cases")
async def graph_use_cases(request: GraphUseCasesRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for use-case extraction")

    system_instruction = (
        "You are an expert research analyst. Return only valid JSON. "
        "Extract practical, real-world use cases grounded in the provided paper text."
    )
    prompt = (
        "From the paper text below, extract the most concrete use cases.\n"
        "Return ONLY JSON matching exactly this schema:\n"
        "{\n"
        '  "use_cases": [\n'
        '    {"title": string, "description": string}\n'
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Return 4 to 6 use cases.\n"
        "- Each title should be short and specific.\n"
        "- Each description must clearly explain how the paper's method applies in practice.\n"
        "- Do not add markdown fences.\n\n"
        f"Paper text:\n{paper_text[:30000]}"
    )

    try:
        raw = await call_gemini(prompt, system_instruction=system_instruction, require_json=True)
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raw_retry = await call_gemini(
            prompt + "\n\nReturn pure JSON only.",
            system_instruction=system_instruction,
            require_json=True,
        )
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for use-case extraction") from exc
    return {"use_cases": _validate_use_cases_payload(parsed)}


@app.post("/graph/sessions")
async def graph_create_session(request: GraphSessionCreateRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    session_doc = {
        "session_id": session_id,
        "title": (request.title or "Paper Graph Session")[:120],
        "paper_context": (request.paper_context or "")[:8000],
        "created_at": now,
        "updated_at": now,
    }
    await graph_sessions_collection.insert_one(session_doc)
    return {"session_id": session_id, "title": session_doc["title"]}


@app.get("/graph/sessions/{session_id}")
async def graph_get_session(session_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")
    session = await graph_sessions_collection.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Graph session not found")

    messages = await graph_messages_collection.find(
        {"session_id": session_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(length=2000)
    return {"session": session, "messages": messages}


@app.get("/graph/sessions/{session_id}/nodes/{node_id}/messages")
async def graph_get_node_messages(session_id: str, node_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    messages = await graph_messages_collection.find(
        {"session_id": session_id, "node_id": node_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(length=300)
    return {"messages": messages}


@app.post("/graph/ask")
async def graph_ask(request: GraphAskRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    if not request.paper_context.strip():
        raise HTTPException(status_code=400, detail="paper_context is required")

    trimmed_history = request.history[-8:]
    history_text = "\n".join(
        [
            f"{str(item.get('role', 'user')).upper()}: {str(item.get('content', ''))[:500]}"
            for item in trimmed_history
            if isinstance(item, dict)
        ]
    )

    system_instruction = (
        "You are a precise research paper tutor. Use only the provided paper context. "
        "If context is insufficient, say so explicitly."
    )
    prompt = (
        f"Concept: {request.concept}\n"
        f"Question: {request.question}\n\n"
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"Paper context:\n{request.paper_context[:25000]}\n\n"
        "Answer clearly in 4-8 sentences."
    )

    answer = await call_gemini(prompt, system_instruction=system_instruction, require_json=False)

    if request.session_id and request.node_id and client:
        now = datetime.now(timezone.utc)
        await graph_messages_collection.insert_many(
            [
                {
                    "session_id": request.session_id,
                    "node_id": request.node_id,
                    "concept": request.concept,
                    "role": "user",
                    "content": request.question.strip(),
                    "created_at": now,
                },
                {
                    "session_id": request.session_id,
                    "node_id": request.node_id,
                    "concept": request.concept,
                    "role": "assistant",
                    "content": answer,
                    "created_at": now,
                },
            ]
        )
        await graph_sessions_collection.update_one(
            {"session_id": request.session_id},
            {"$set": {"updated_at": now}},
        )

    return {"answer": answer}


@app.post("/sessions")
async def create_session(request: CreateSessionRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    session_id = str(uuid.uuid4())
    share_token = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc)

    doc_filename = None
    if request.doc_id:
        first_chunk = await documents_collection.find_one({"doc_id": request.doc_id}, {"filename": 1})
        if first_chunk:
            doc_filename = first_chunk.get("filename")

    session_doc = {
        "session_id": session_id,
        "share_token": share_token,
        "doc_id": request.doc_id,
        "title": request.title or (doc_filename and f"Session: {doc_filename}") or "Untitled Session",
        "created_at": now,
        "updated_at": now,
    }

    await sessions_collection.insert_one(session_doc)

    return {
        "session_id": session_id,
        "share_token": share_token,
        "share_url": f"/share/{share_token}",
        "title": session_doc["title"],
    }


@app.get("/sessions/{session_id}")
async def get_session(session_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    session = await sessions_collection.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages_cursor = messages_collection.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1)
    messages = await messages_cursor.to_list(length=500)

    return {"session": session, "messages": messages}


@app.get("/share/{share_token}")
async def get_shared_session(share_token: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    session = await sessions_collection.find_one({"share_token": share_token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Shared session not found")

    messages_cursor = messages_collection.find({"session_id": session["session_id"]}, {"_id": 0}).sort("created_at", 1)
    messages = await messages_cursor.to_list(length=500)

    return {"session": session, "messages": messages}


@app.get("/chat/conversations")
async def list_chat_conversations():
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    docs = await chat_conversations_collection.find(
        {},
        {
            "_id": 0,
            "conversation_id": 1,
            "title": 1,
            "doc_id": 1,
            "file_name": 1,
            "session_id": 1,
            "created_at": 1,
            "updated_at": 1,
            "logs": 1,
            "citations": 1,
            "telemetry": 1,
            "doc_meta": 1,
        },
    ).sort("updated_at", -1).to_list(length=500)
    return {"conversations": docs}


@app.post("/chat/conversations/{conversation_id}/state")
async def upsert_chat_conversation_state(conversation_id: str, request: ChatConversationStateRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")
    if not request.title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    now = datetime.now(timezone.utc)
    update_doc = {
        "title": request.title.strip()[:120],
        "doc_id": request.doc_id,
        "file_name": request.file_name,
        "session_id": request.session_id,
        "logs": request.logs[-500:],
        "citations": request.citations[:80],
        "telemetry": request.telemetry,
        "doc_meta": request.doc_meta,
        "updated_at": now,
    }
    await chat_conversations_collection.update_one(
        {"conversation_id": conversation_id},
        {
            "$set": update_doc,
            "$setOnInsert": {
                "conversation_id": conversation_id,
                "created_at": now,
            },
        },
        upsert=True,
    )
    return {"ok": True}


@app.patch("/chat/conversations/{conversation_id}")
async def rename_chat_conversation(conversation_id: str, request: ChatConversationRenameRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")
    title = request.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    result = await chat_conversations_collection.update_one(
        {"conversation_id": conversation_id},
        {"$set": {"title": title[:120], "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@app.delete("/chat/conversations/{conversation_id}")
async def delete_chat_conversation(conversation_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")
    result = await chat_conversations_collection.delete_one({"conversation_id": conversation_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        ingest_start = time.perf_counter()

        pdf_bytes = await file.read()
        pages = extract_pages_from_pdf(pdf_bytes)
        if not pages:
            raise HTTPException(
                status_code=400,
                detail="No extractable text found in this PDF. If it is scanned, run OCR first.",
            )

        doc_id = str(uuid.uuid4())
        insert_data = []

        capped = False
        lexical_fallback_triggered = False
        embedded_count = 0
        lexical_only_count = 0

        for page in pages:
            page_number = int(page["page_number"])
            page_chunks = [
                chunk
                for chunk in chunk_text(
                    page["text"],
                    chunk_size=UPLOAD_CHUNK_SIZE,
                    overlap=UPLOAD_CHUNK_OVERLAP,
                )
                if chunk.strip()
            ]
            for page_chunk_index, chunk in enumerate(page_chunks):
                if len(insert_data) >= UPLOAD_MAX_CHUNKS:
                    capped = True
                    break
                try:
                    embedding = await _embed_via_rest(chunk)
                    insert_data.append(
                        {
                            "doc_id": doc_id,
                            "filename": filename,
                            "page_number": page_number,
                            "chunk_index": page_chunk_index,
                            "text": chunk,
                            "embedding": embedding,
                        }
                    )
                    embedded_count += 1
                except HTTPException as embed_exc:
                    # If Gemini embeddings are throttled, continue in lexical-only mode.
                    if embed_exc.status_code == 429 and EMBED_ALLOW_LEXICAL_FALLBACK:
                        lexical_fallback_triggered = True
                        insert_data.append(
                            {
                                "doc_id": doc_id,
                                "filename": filename,
                                "page_number": page_number,
                                "chunk_index": page_chunk_index,
                                "text": chunk,
                            }
                        )
                        lexical_only_count += 1
                    else:
                        raise
            if capped:
                break

        if not insert_data:
            raise HTTPException(status_code=400, detail="Document produced zero text chunks.")

        insert_result = await documents_collection.insert_many(insert_data)

        return {
            "message": f"Successfully processed {filename}.",
            "doc_id": doc_id,
            "chunks_processed": len(insert_data),
            "chunks_stored": len(insert_result.inserted_ids),
            "page_count": len(pages),
            "chunking": {
                "chunk_size": UPLOAD_CHUNK_SIZE,
                "chunk_overlap": UPLOAD_CHUNK_OVERLAP,
                "max_chunks": UPLOAD_MAX_CHUNKS,
                "capped": capped,
            },
            "retrieval_mode": "lexical_only" if lexical_fallback_triggered and embedded_count == 0 else ("hybrid" if embedded_count > 0 else "lexical_only"),
            "embedding_stats": {
                "embedded_chunks": embedded_count,
                "lexical_only_chunks": lexical_only_count,
                "lexical_fallback_triggered": lexical_fallback_triggered,
            },
            "telemetry": {
                "ingest_ms": round((time.perf_counter() - ingest_start) * 1000, 1),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/documents/{doc_id}/context", response_model=UploadedPaperContextResponse)
async def get_document_context(doc_id: str):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    docs = await documents_collection.find(
        {"doc_id": doc_id},
        {"_id": 0, "filename": 1, "page_number": 1, "chunk_index": 1, "text": 1},
    ).to_list(length=10000)

    if not docs:
        raise HTTPException(status_code=404, detail="Document not found")

    docs.sort(key=lambda d: (int(d.get("page_number", 0)), int(d.get("chunk_index", 0))))
    paper_text = "\n\n".join(str(d.get("text", "")).strip() for d in docs if str(d.get("text", "")).strip())
    if not paper_text:
        raise HTTPException(status_code=400, detail="No text available for this document")

    page_count = len({int(d.get("page_number", 0)) for d in docs if d.get("page_number") is not None})
    filename = str(docs[0].get("filename")) if docs else None

    return UploadedPaperContextResponse(
        doc_id=doc_id,
        filename=filename,
        paper_text=paper_text[:60000],
        page_count=page_count,
        chunk_count=len(docs),
    )


@app.post("/query")
async def query_savant(request: QueryRequest):
    if not client:
        raise HTTPException(status_code=500, detail="Database not configured")

    try:
        start_time = time.perf_counter()

        payment_info = None
        payment_verify_ms = 0.0
        if REQUIRE_SOLANA_PAYMENT:
            if not request.payment_signature or not request.payer_pubkey:
                raise HTTPException(status_code=402, detail="Payment required before querying")

            payment_start = time.perf_counter()
            existing = await payments_collection.find_one({"signature": request.payment_signature})
            if existing:
                raise HTTPException(status_code=402, detail="Payment signature already used")

            payment_info = await _verify_solana_payment(request.payment_signature, request.payer_pubkey)
            payment_verify_ms = (time.perf_counter() - payment_start) * 1000

            await payments_collection.insert_one(
                {
                    **payment_info,
                    "session_id": request.session_id,
                    "doc_id": request.doc_id,
                    "created_at": datetime.now(timezone.utc),
                }
            )

        if not os.getenv("GEMINI_API_KEY"):
            raise HTTPException(status_code=500, detail="Gemini API not configured")

        embed_start = time.perf_counter()
        query_embedding = None
        embed_ms = 0.0
        retrieval_mode = "hybrid"
        try:
            query_embedding = await _embed_via_rest(request.prompt)
            embed_ms = (time.perf_counter() - embed_start) * 1000
        except HTTPException as embed_exc:
            if embed_exc.status_code == 429 and EMBED_ALLOW_LEXICAL_FALLBACK:
                retrieval_mode = "lexical_only"
            else:
                raise

        vector_filter = {}
        if request.doc_id:
            vector_filter["doc_id"] = {"$eq": request.doc_id}
        if request.page_number is not None:
            vector_filter["page_number"] = {"$eq": request.page_number}

        pipeline = []
        if query_embedding is not None:
            pipeline = [
                {
                    "$vectorSearch": {
                        "index": "vector_index",
                        "path": "embedding",
                        "queryVector": query_embedding,
                        "numCandidates": 200,
                        "limit": 10,
                    }
                }
            ]

            if vector_filter:
                pipeline[0]["$vectorSearch"]["filter"] = vector_filter

            pipeline.append(
                {
                    "$project": {
                        "_id": 0,
                        "doc_id": 1,
                        "filename": 1,
                        "page_number": 1,
                        "chunk_index": 1,
                        "text": 1,
                        "score": {"$meta": "vectorSearchScore"},
                    }
                }
            )

        retrieval_start = time.perf_counter()
        vector_results = await documents_collection.aggregate(pipeline).to_list(length=10) if pipeline else []

        filter_query = {}
        if request.doc_id:
            filter_query["doc_id"] = request.doc_id
        if request.page_number is not None:
            filter_query["page_number"] = request.page_number

        fallback_docs = []
        if filter_query:
            fallback_docs = await documents_collection.find(
                filter_query,
                {"_id": 0, "doc_id": 1, "filename": 1, "page_number": 1, "chunk_index": 1, "text": 1},
            ).to_list(length=2000)

        lexical_results = _fallback_chunks_for_prompt(request.prompt, fallback_docs, limit=10) if fallback_docs else []
        merged_results = _hybrid_rerank(request.prompt, [*vector_results, *lexical_results], limit=5)

        retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

        if not merged_results:
            context_text = "No relevant context found."
        else:
            context_text = "\n\n".join([doc.get("text", "") for doc in merged_results])

        system_prompt = (
            "You are Savant. Answer the user's prompt using ONLY the provided text context. "
            "Be concise, conversational, and include exact references like (page X)."
        )
        full_prompt = f"{system_prompt}\n\nContext:\n{context_text}\n\nUser Question:\n{request.prompt}"

        llm_start = time.perf_counter()
        llm_fallback = False
        try:
            answer_text = await call_gemini(full_prompt, require_json=False)
        except HTTPException as llm_exc:
            if llm_exc.status_code == 429 and ALLOW_GENERATE_LOCAL_FALLBACK:
                llm_fallback = True
                answer_text = _local_answer_from_context(request.prompt, context_text)
            else:
                raise
        llm_ms = (time.perf_counter() - llm_start) * 1000

        import base64

        audio_base64 = None
        tts_ms = 0.0
        if elevenlabs_client:
            try:
                tts_start = time.perf_counter()
                audio_generator = elevenlabs_client.text_to_speech.convert(
                    voice_id=VOICE_ID,
                    output_format="mp3_44100_128",
                    text=answer_text,
                    model_id="eleven_turbo_v2_5",
                )
                audio_bytes = b"".join(list(audio_generator))
                audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
                tts_ms = (time.perf_counter() - tts_start) * 1000
            except Exception as audio_err:
                print(f"ElevenLabs audio skipped: {audio_err}")

        citations = [
            {
                "filename": doc.get("filename"),
                "page_number": doc.get("page_number"),
                "chunk_index": doc.get("chunk_index"),
                "score": round(float(doc.get("score", 0.0)), 4),
                "snippet": str(doc.get("text", ""))[:260],
            }
            for doc in merged_results
        ]

        if request.session_id:
            session = await sessions_collection.find_one({"session_id": request.session_id})
            if session:
                now = datetime.now(timezone.utc)
                await messages_collection.insert_one(
                    {
                        "session_id": request.session_id,
                        "doc_id": request.doc_id,
                        "prompt": request.prompt,
                        "answer": answer_text,
                        "citations": citations,
                        "payment_signature": request.payment_signature,
                        "created_at": now,
                    }
                )
                await sessions_collection.update_one(
                    {"session_id": request.session_id},
                    {"$set": {"updated_at": now}},
                )

        total_ms = (time.perf_counter() - start_time) * 1000

        return {
            "answer": answer_text,
            "audio_base64": audio_base64,
            "context_used": [doc.get("chunk_index") for doc in merged_results],
            "citations": citations,
            "session_id": request.session_id,
            "payment": payment_info,
            "telemetry": {
                "embed_ms": round(embed_ms, 1),
                "retrieval_ms": round(retrieval_ms, 1),
                "llm_ms": round(llm_ms, 1),
                "tts_ms": round(tts_ms, 1),
                "payment_verify_ms": round(payment_verify_ms, 1),
                "total_ms": round(total_ms, 1),
                "retrieval_mode": retrieval_mode,
                "llm_fallback": llm_fallback,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
