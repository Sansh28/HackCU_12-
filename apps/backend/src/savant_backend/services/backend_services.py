import asyncio
import base64
import io
import json
import logging
import time
from contextvars import ContextVar
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from PyPDF2 import PdfReader

from savant_backend import config, store
from savant_backend.models import VALID_GRAPH_CATEGORIES
from savant_backend.core_logic import (
    chunk_text as _chunk_text,
    enforce_dag_edges,
    extract_retry_delay_seconds,
    fallback_chunks_for_prompt,
    hybrid_rerank,
    local_answer_from_context,
)

LAST_EMBED_TS = 0.0
REQUEST_ID_CTX: ContextVar[str] = ContextVar("request_id", default="-")
REQUEST_PATH_CTX: ContextVar[str] = ContextVar("request_path", default="-")
REQUEST_METHOD_CTX: ContextVar[str] = ContextVar("request_method", default="-")


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": config.SERVICE_NAME,
            "message": record.getMessage(),
        }
        details = getattr(record, "details", None)
        if isinstance(details, dict):
            payload.update(details)
        return json.dumps(payload, default=str)


logger = logging.getLogger(config.SERVICE_NAME)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logger.addHandler(handler)
logger.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))
logger.propagate = False


def bind_request_context(request_id: str, path: str, method: str) -> None:
    REQUEST_ID_CTX.set(request_id)
    REQUEST_PATH_CTX.set(path)
    REQUEST_METHOD_CTX.set(method)


def clear_request_context() -> None:
    REQUEST_ID_CTX.set("-")
    REQUEST_PATH_CTX.set("-")
    REQUEST_METHOD_CTX.set("-")


def get_request_context() -> dict:
    return {
        "request_id": REQUEST_ID_CTX.get(),
        "path": REQUEST_PATH_CTX.get(),
        "method": REQUEST_METHOD_CTX.get(),
    }


def log_event(level: int, event: str, **fields) -> None:
    logger.log(level, event, extra={"details": {**get_request_context(), "event": event, **fields}})


def require_database() -> None:
    if not store.client:
        log_event(logging.ERROR, "database_not_configured")
        raise HTTPException(status_code=500, detail="Database not configured")


def require_runtime_config() -> None:
    missing = [key for key, present in config.settings.REQUIRED_RUNTIME_KEYS.items() if not present]
    if missing:
        log_event(logging.ERROR, "runtime_config_incomplete", missing=missing)
        raise HTTPException(status_code=500, detail=f"Missing required runtime configuration: {', '.join(missing)}")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def call_gemini(contents: str, system_instruction: str | None = None, require_json: bool = False) -> str:
    if not config.GEMINI_API_KEY:
        log_event(logging.ERROR, "gemini_not_configured")
        raise HTTPException(status_code=500, detail="Gemini API not configured")

    call_start = time.perf_counter()
    payload: dict = {"contents": [{"role": "user", "parts": [{"text": contents}]}]}
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    if require_json:
        payload["generationConfig"] = {"responseMimeType": "application/json"}

    log_event(logging.INFO, "gemini_request_started", require_json=require_json, prompt_chars=len(contents))

    last_status_code = None
    last_error_detail = None
    data = None

    async with httpx.AsyncClient(timeout=45) as http_client:
        for attempt in range(config.GENERATE_MAX_RETRIES + 1):
            try:
                response = await http_client.post(f"{config.GEMINI_GENERATE_URL}?key={config.GEMINI_API_KEY}", json=payload)
                if response.status_code == 429:
                    last_status_code = 429
                    try:
                        error_data = response.json()
                    except ValueError:
                        error_data = {}
                    last_error_detail = error_data
                    log_event(logging.WARNING, "gemini_rate_limited", attempt=attempt + 1, max_retries=config.GENERATE_MAX_RETRIES)
                    if attempt >= config.GENERATE_MAX_RETRIES:
                        break
                    await asyncio.sleep(
                        extract_retry_delay_seconds(
                            error_data,
                            attempt,
                            config.GENERATE_RETRY_BASE_SECONDS,
                            config.GENERATE_RETRY_MAX_SECONDS,
                        )
                    )
                    continue

                response.raise_for_status()
                data = response.json()
                break
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_status_code = 429
                    log_event(logging.WARNING, "gemini_rate_limited", attempt=attempt + 1, max_retries=config.GENERATE_MAX_RETRIES)
                    if attempt >= config.GENERATE_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(config.GENERATE_RETRY_BASE_SECONDS * (2 ** attempt), config.GENERATE_RETRY_MAX_SECONDS))
                    continue
                log_event(logging.ERROR, "gemini_http_error", status_code=exc.response.status_code, detail=str(exc))
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc
            except httpx.RequestError as exc:
                log_event(logging.ERROR, "gemini_request_error", detail=str(exc))
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc

    if last_status_code == 429 and not data:
        detail_msg = "Gemini text-generation quota exceeded. Wait ~1 minute and retry, switch API key/project, or reduce query volume."
        if isinstance(last_error_detail, dict):
            api_msg = str(last_error_detail.get("error", {}).get("message", "")).strip()
            if api_msg:
                detail_msg = api_msg
        log_event(logging.ERROR, "gemini_exhausted_retries", detail=detail_msg)
        raise HTTPException(status_code=429, detail=detail_msg)

    if not data:
        log_event(logging.ERROR, "gemini_empty_response")
        raise HTTPException(status_code=502, detail="Gemini returned empty response")

    candidates = data.get("candidates", [])
    if not candidates:
        log_event(logging.ERROR, "gemini_no_candidates")
        raise HTTPException(status_code=502, detail="Gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text_output = "".join(part.get("text", "") for part in parts if part.get("text")).strip()
    if not text_output:
        log_event(logging.ERROR, "gemini_empty_content")
        raise HTTPException(status_code=502, detail="Gemini returned empty content")
    log_event(logging.INFO, "gemini_request_succeeded", output_chars=len(text_output), duration_ms=round((time.perf_counter() - call_start) * 1000, 1))
    return text_output


def validate_graph_payload(payload: dict) -> dict:
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
        nodes.append(
            {
                "id": node_id,
                "label": str(raw_node.get("label", node_id)).strip()[:80] or node_id,
                "summary": str(raw_node.get("summary", "")).strip()[:500],
                "category": category,
                "importance": importance,
            }
        )
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
        seen_edges.add(key)
        edges.append({"source": source, "target": target, "label": label})

    if not edges:
        node_ids = [node["id"] for node in nodes]
        for idx in range(len(node_ids) - 1):
            edges.append({"source": node_ids[idx], "target": node_ids[idx + 1], "label": "supports"})

    return {"title": title[:120], "nodes": nodes, "edges": enforce_dag_edges(nodes, edges)}


def validate_use_cases_payload(payload: dict) -> list[dict]:
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


def extract_pages_from_pdf(pdf_bytes: bytes) -> list[dict]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    pages: list[dict] = []
    for idx, page in enumerate(reader.pages, start=1):
        page_text = (page.extract_text() or "").strip()
        if page_text:
            pages.append({"page_number": idx, "text": page_text})
    return pages


def summarize_pages(pages: list[dict]) -> str:
    combined = " ".join(str(page.get("text", "")).strip() for page in pages[:3]).strip()
    if not combined:
        return ""
    compact = " ".join(combined.split())
    return compact[:500]


async def embed_via_rest(text: str) -> list[float]:
    global LAST_EMBED_TS
    if not config.GEMINI_API_KEY:
        log_event(logging.ERROR, "embedding_not_configured")
        raise HTTPException(status_code=500, detail="Gemini API not configured")

    embed_start = time.perf_counter()
    last_status_code = None
    async with httpx.AsyncClient(timeout=config.EMBED_REQUEST_TIMEOUT_SECONDS) as http_client:
        for attempt in range(config.EMBED_MAX_RETRIES + 1):
            try:
                if config.EMBED_MIN_INTERVAL_SECONDS > 0:
                    now = time.monotonic()
                    elapsed = now - LAST_EMBED_TS
                    if elapsed < config.EMBED_MIN_INTERVAL_SECONDS:
                        await asyncio.sleep(config.EMBED_MIN_INTERVAL_SECONDS - elapsed)
                    LAST_EMBED_TS = time.monotonic()

                response = await http_client.post(
                    f"{config.GEMINI_EMBED_URL}?key={config.GEMINI_API_KEY}",
                    json={"content": {"parts": [{"text": text}]}} ,
                )
                if response.status_code == 429:
                    last_status_code = 429
                    log_event(logging.WARNING, "embedding_rate_limited", attempt=attempt + 1, max_retries=config.EMBED_MAX_RETRIES)
                    if attempt >= config.EMBED_MAX_RETRIES:
                        break
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            sleep_seconds = min(float(retry_after), config.EMBED_RETRY_MAX_SECONDS)
                        except ValueError:
                            sleep_seconds = min(config.EMBED_RETRY_BASE_SECONDS * (2 ** attempt), config.EMBED_RETRY_MAX_SECONDS)
                    else:
                        sleep_seconds = min(config.EMBED_RETRY_BASE_SECONDS * (2 ** attempt), config.EMBED_RETRY_MAX_SECONDS)
                    await asyncio.sleep(sleep_seconds)
                    continue

                response.raise_for_status()
                data = response.json()
                values = data["embedding"]["values"] if "embedding" in data else data["embeddings"][0]["values"]
                log_event(logging.INFO, "embedding_request_succeeded", text_chars=len(text), vector_dimensions=len(values), duration_ms=round((time.perf_counter() - embed_start) * 1000, 1))
                if "embedding" in data:
                    return data["embedding"]["values"]
                return data["embeddings"][0]["values"]
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_status_code = 429
                    log_event(logging.WARNING, "embedding_rate_limited", attempt=attempt + 1, max_retries=config.EMBED_MAX_RETRIES)
                    if attempt >= config.EMBED_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(config.EMBED_RETRY_BASE_SECONDS * (2 ** attempt), config.EMBED_RETRY_MAX_SECONDS))
                    continue
                log_event(logging.ERROR, "embedding_http_error", status_code=exc.response.status_code, detail=str(exc))
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc
            except httpx.RequestError as exc:
                log_event(logging.ERROR, "embedding_request_error", detail=str(exc))
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc

    if last_status_code == 429:
        log_event(logging.ERROR, "embedding_exhausted_retries")
        raise HTTPException(
            status_code=429,
            detail="Gemini embedding rate limit reached. Please wait 1-2 minutes and retry, or reduce upload size / increase plan quota.",
        )
    log_event(logging.ERROR, "embedding_request_failed")
    raise HTTPException(status_code=500, detail="Embedding request failed")


async def ingest_document_payload(owner_id: str, doc_id: str, filename: str, pdf_bytes: bytes) -> dict:
    pages = extract_pages_from_pdf(pdf_bytes)
    if not pages:
        raise HTTPException(status_code=400, detail="No extractable text found in this PDF. If it is scanned, run OCR first.")

    insert_data = []
    capped = False
    lexical_fallback_triggered = False
    embedded_count = 0
    lexical_only_count = 0

    for page in pages:
        page_number = int(page["page_number"])
        page_chunks = [chunk for chunk in chunk_text(page["text"], chunk_size=config.UPLOAD_CHUNK_SIZE, overlap=config.UPLOAD_CHUNK_OVERLAP) if chunk.strip()]
        for page_chunk_index, chunk in enumerate(page_chunks):
            if len(insert_data) >= config.UPLOAD_MAX_CHUNKS:
                capped = True
                break
            base_doc = {
                "owner_id": owner_id,
                "doc_id": doc_id,
                "page_number": page_number,
                "chunk_index": page_chunk_index,
                "text": chunk,
            }
            try:
                embedding = await embed_via_rest(chunk)
                insert_data.append({**base_doc, "embedding": embedding})
                embedded_count += 1
            except HTTPException as exc:
                if exc.status_code == 429 and config.EMBED_ALLOW_LEXICAL_FALLBACK:
                    lexical_fallback_triggered = True
                    insert_data.append(base_doc)
                    lexical_only_count += 1
                else:
                    raise
        if capped:
            break

    if not insert_data:
        raise HTTPException(status_code=400, detail="Document produced zero text chunks.")

    retrieval_mode = "lexical_only" if lexical_fallback_triggered and embedded_count == 0 else ("hybrid" if embedded_count > 0 else "lexical_only")
    return {
        "page_count": len(pages),
        "chunks": insert_data,
        "chunk_count": len(insert_data),
        "chunking": {
            "chunk_size": config.UPLOAD_CHUNK_SIZE,
            "chunk_overlap": config.UPLOAD_CHUNK_OVERLAP,
            "max_chunks": config.UPLOAD_MAX_CHUNKS,
            "capped": capped,
        },
        "retrieval_mode": retrieval_mode,
        "summary": summarize_pages(pages),
        "paper_text": "\n\n".join(str(page.get("text", "")).strip() for page in pages if str(page.get("text", "")).strip())[:60000],
        "embedding_stats": {
            "embedded_chunks": embedded_count,
            "lexical_only_chunks": lexical_only_count,
            "lexical_fallback_triggered": lexical_fallback_triggered,
        },
    }


async def extract_graph_from_text(paper_text: str) -> dict:
    system_instruction = "You are an expert research assistant. Return only valid JSON. Extract 8-16 key concepts from paper text and relations between them."
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
        raw_retry = await call_gemini(prompt + "\n\nReturn pure JSON only.", system_instruction=system_instruction, require_json=True)
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for graph extraction") from exc
    return validate_graph_payload(parsed)


async def extract_use_cases_from_text(paper_text: str) -> list[dict]:
    system_instruction = "You are an expert research analyst. Return only valid JSON. Extract practical, real-world use cases grounded in the provided paper text."
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
        raw_retry = await call_gemini(prompt + "\n\nReturn pure JSON only.", system_instruction=system_instruction, require_json=True)
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for use-case extraction") from exc
    return validate_use_cases_payload(parsed)


async def verify_solana_payment(signature: str, payer_pubkey: str) -> dict:
    if not config.MASTER_WALLET:
        log_event(logging.ERROR, "payment_wallet_not_configured")
        raise HTTPException(status_code=500, detail="MASTER_WALLET is not configured")

    payment_start = time.perf_counter()
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
            rpc_res = await http_client.post(config.SOLANA_RPC_URL, json=payload)
            rpc_res.raise_for_status()
            rpc_data = rpc_res.json()
    except httpx.RequestError as exc:
        log_event(logging.ERROR, "payment_rpc_request_error", detail=str(exc))
        raise HTTPException(status_code=502, detail=f"Solana RPC request failed: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        log_event(logging.ERROR, "payment_rpc_http_error", status_code=exc.response.status_code, detail=str(exc))
        raise HTTPException(status_code=502, detail=f"Solana RPC request failed: {exc}") from exc

    tx = rpc_data.get("result")
    if not tx:
        log_event(logging.WARNING, "payment_not_found", signature=signature)
        raise HTTPException(status_code=402, detail="Payment transaction not found or not confirmed")
    if tx.get("meta", {}).get("err"):
        log_event(logging.WARNING, "payment_failed", signature=signature)
        raise HTTPException(status_code=402, detail="Payment transaction failed")

    block_time = tx.get("blockTime")
    if block_time is not None:
        age_seconds = int(time.time()) - int(block_time)
        if age_seconds > config.PAYMENT_WINDOW_SECONDS:
            log_event(logging.WARNING, "payment_too_old", signature=signature, age_seconds=age_seconds)
            raise HTTPException(status_code=402, detail="Payment transaction is too old")

    paid_lamports = 0
    for instruction in tx.get("transaction", {}).get("message", {}).get("instructions", []):
        parsed = instruction.get("parsed")
        if not isinstance(parsed, dict) or parsed.get("type") != "transfer":
            continue
        info = parsed.get("info", {})
        if info.get("destination") == config.MASTER_WALLET and info.get("source") == payer_pubkey:
            paid_lamports += int(info.get("lamports", 0))

    if paid_lamports < config.QUERY_PRICE_LAMPORTS:
        log_event(logging.WARNING, "payment_insufficient", signature=signature, paid_lamports=paid_lamports, required_lamports=config.QUERY_PRICE_LAMPORTS)
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient payment. Expected {config.QUERY_PRICE_LAMPORTS} lamports, got {paid_lamports}.",
        )

    result = {
        "signature": signature,
        "payer_pubkey": payer_pubkey,
        "destination": config.MASTER_WALLET,
        "paid_lamports": paid_lamports,
    }
    log_event(logging.INFO, "payment_verified", signature=signature, paid_lamports=paid_lamports, duration_ms=round((time.perf_counter() - payment_start) * 1000, 1))
    return result


async def synthesize_audio(answer_text: str) -> tuple[str | None, float]:
    if not store.elevenlabs_client:
        log_event(logging.INFO, "audio_skipped", reason="elevenlabs_not_configured")
        return None, 0.0
    try:
        tts_start = time.perf_counter()
        audio_generator = store.elevenlabs_client.text_to_speech.convert(
            voice_id=config.VOICE_ID,
            output_format="mp3_44100_128",
            text=answer_text,
            model_id="eleven_turbo_v2_5",
        )
        audio_bytes = b"".join(list(audio_generator))
        duration_ms = (time.perf_counter() - tts_start) * 1000
        log_event(logging.INFO, "audio_generated", answer_chars=len(answer_text), bytes=len(audio_bytes), duration_ms=round(duration_ms, 1))
        return base64.b64encode(audio_bytes).decode("utf-8"), duration_ms
    except Exception as exc:
        log_event(logging.WARNING, "audio_generation_failed", detail=str(exc))
        return None, 0.0


def build_context_text(results: list[dict]) -> str:
    if not results:
        return "No relevant context found."
    return "\n\n".join(doc.get("text", "") for doc in results)


def explain_result_selection(prompt: str, doc: dict) -> dict:
    snippet = str(doc.get("text", "")).strip()
    prompt_terms = [term.lower() for term in prompt.split() if len(term.strip()) > 3]
    matched_terms = []
    snippet_lower = snippet.lower()
    for term in prompt_terms:
        if term in snippet_lower and term not in matched_terms:
            matched_terms.append(term)

    reasons: list[str] = []
    score = float(doc.get("score", 0.0) or 0.0)
    if score >= 0.85:
        reasons.append("High semantic match score")
    elif score >= 0.5:
        reasons.append("Relevant semantic match")
    if matched_terms:
        reasons.append(f"Matched query terms: {', '.join(matched_terms[:4])}")
    if doc.get("page_number") is not None:
        reasons.append(f"Located on page {doc.get('page_number')}")
    if not reasons:
        reasons.append("Used as supporting context for answer synthesis")

    return {
        "selection_reason": " • ".join(reasons),
        "match_terms": matched_terms[:6],
    }


def build_citations(results: list[dict], prompt: str = "") -> list[dict]:
    return [
        {
            "filename": doc.get("filename"),
            "page_number": doc.get("page_number"),
            "chunk_index": doc.get("chunk_index"),
            "score": round(float(doc.get("score", 0.0)), 4),
            "snippet": str(doc.get("text", ""))[:260],
            **explain_result_selection(prompt, doc),
        }
        for doc in results
    ]


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    return _chunk_text(text, chunk_size=chunk_size, overlap=overlap)


def lexical_results_for_prompt(prompt: str, docs: list[dict], limit: int = 10) -> list[dict]:
    return fallback_chunks_for_prompt(prompt, docs, limit=limit)


def rerank_results(prompt: str, vector_results: list[dict], lexical_results: list[dict], limit: int = 5) -> list[dict]:
    return hybrid_rerank(prompt, [*vector_results, *lexical_results], limit=limit)


def fallback_answer(prompt: str, context_text: str) -> str:
    return local_answer_from_context(prompt, context_text)
