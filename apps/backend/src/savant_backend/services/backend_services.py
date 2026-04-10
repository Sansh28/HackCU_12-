import asyncio
import base64
import io
import time
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


def require_database() -> None:
    if not store.client:
        raise HTTPException(status_code=500, detail="Database not configured")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def call_gemini(contents: str, system_instruction: str | None = None, require_json: bool = False) -> str:
    if not config.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API not configured")

    payload: dict = {"contents": [{"role": "user", "parts": [{"text": contents}]}]}
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    if require_json:
        payload["generationConfig"] = {"responseMimeType": "application/json"}

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
                    if attempt >= config.GENERATE_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(config.GENERATE_RETRY_BASE_SECONDS * (2 ** attempt), config.GENERATE_RETRY_MAX_SECONDS))
                    continue
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc

    if last_status_code == 429 and not data:
        detail_msg = "Gemini text-generation quota exceeded. Wait ~1 minute and retry, switch API key/project, or reduce query volume."
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
    text_output = "".join(part.get("text", "") for part in parts if part.get("text")).strip()
    if not text_output:
        raise HTTPException(status_code=502, detail="Gemini returned empty content")
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


async def embed_via_rest(text: str) -> list[float]:
    global LAST_EMBED_TS
    if not config.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Gemini API not configured")

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
                    json={"content": {"parts": [{"text": text}]}},
                )
                if response.status_code == 429:
                    last_status_code = 429
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
                if "embedding" in data:
                    return data["embedding"]["values"]
                return data["embeddings"][0]["values"]
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    last_status_code = 429
                    if attempt >= config.EMBED_MAX_RETRIES:
                        break
                    await asyncio.sleep(min(config.EMBED_RETRY_BASE_SECONDS * (2 ** attempt), config.EMBED_RETRY_MAX_SECONDS))
                    continue
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Embedding request failed: {exc}") from exc

    if last_status_code == 429:
        raise HTTPException(
            status_code=429,
            detail="Gemini embedding rate limit reached. Please wait 1-2 minutes and retry, or reduce upload size / increase plan quota.",
        )
    raise HTTPException(status_code=500, detail="Embedding request failed")


async def verify_solana_payment(signature: str, payer_pubkey: str) -> dict:
    if not config.MASTER_WALLET:
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
            rpc_res = await http_client.post(config.SOLANA_RPC_URL, json=payload)
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
        if age_seconds > config.PAYMENT_WINDOW_SECONDS:
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
        raise HTTPException(
            status_code=402,
            detail=f"Insufficient payment. Expected {config.QUERY_PRICE_LAMPORTS} lamports, got {paid_lamports}.",
        )

    return {
        "signature": signature,
        "payer_pubkey": payer_pubkey,
        "destination": config.MASTER_WALLET,
        "paid_lamports": paid_lamports,
    }


async def synthesize_audio(answer_text: str) -> tuple[str | None, float]:
    if not store.elevenlabs_client:
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
        return base64.b64encode(audio_bytes).decode("utf-8"), (time.perf_counter() - tts_start) * 1000
    except Exception:
        return None, 0.0


def build_context_text(results: list[dict]) -> str:
    if not results:
        return "No relevant context found."
    return "\n\n".join(doc.get("text", "") for doc in results)


def build_citations(results: list[dict]) -> list[dict]:
    return [
        {
            "filename": doc.get("filename"),
            "page_number": doc.get("page_number"),
            "chunk_index": doc.get("chunk_index"),
            "score": round(float(doc.get("score", 0.0)), 4),
            "snippet": str(doc.get("text", ""))[:260],
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
