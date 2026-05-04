import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from savant_backend import config, models, security, store
from savant_backend.services import backend_services as services

router = APIRouter()
ACTIVE_JOBS: dict[str, asyncio.Task] = {}


async def _insert_document_metadata(owner_id: str, doc_id: str, filename: str) -> dict[str, Any]:
    now = services.now_utc()
    document = {
        "doc_id": doc_id,
        "owner_id": owner_id,
        "filename": filename,
        "status": "queued",
        "page_count": 0,
        "chunk_count": 0,
        "retrieval_mode": "pending",
        "summary": None,
        "embedding_stats": {},
        "graph_status": "idle",
        "graph_cache": None,
        "latest_job_id": None,
        "last_error": None,
        "created_at": now,
        "updated_at": now,
    }
    await store.documents_collection.insert_one(document)
    return document


async def _create_job(owner_id: str, job_type: str, doc_id: str | None, max_retries: int = 1) -> dict[str, Any]:
    job_id = str(uuid.uuid4())
    now = services.now_utc()
    job_doc = {
        "job_id": job_id,
        "job_type": job_type,
        "doc_id": doc_id,
        "owner_id": owner_id,
        "status": "queued",
        "retries": 0,
        "max_retries": max_retries,
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
    }
    await store.jobs_collection.insert_one(job_doc)
    return job_doc


async def _update_job(owner_id: str, job_id: str, **fields: Any) -> None:
    fields["updated_at"] = services.now_utc()
    if fields.get("status") in {"completed", "failed"}:
        fields["completed_at"] = services.now_utc()
    await store.jobs_collection.update_one(security.owner_filter(owner_id, job_id=job_id), {"$set": fields})


async def _delete_existing_chunks(owner_id: str, doc_id: str) -> None:
    if store.document_chunks_collection is None:
        return
    if hasattr(store.document_chunks_collection, "delete_many"):
        await store.document_chunks_collection.delete_many(security.owner_filter(owner_id, doc_id=doc_id))


async def _load_document(owner_id: str, doc_id: str) -> dict[str, Any]:
    document = await store.documents_collection.find_one(security.owner_filter(owner_id, doc_id=doc_id), {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


async def _load_document_chunks(owner_id: str, doc_id: str) -> list[dict[str, Any]]:
    chunks = await store.document_chunks_collection.find(
        security.owner_filter(owner_id, doc_id=doc_id),
        {"_id": 0, "doc_id": 1, "page_number": 1, "chunk_index": 1, "text": 1, "score": 1},
    ).to_list(length=10000)
    chunks.sort(key=lambda item: (int(item.get("page_number", 0)), int(item.get("chunk_index", 0))))
    return chunks


async def _run_ingestion_job(job_id: str, owner_id: str, doc_id: str, filename: str, pdf_bytes: bytes) -> None:
    attempts = 0
    while True:
        attempts += 1
        await _update_job(owner_id, job_id, status="processing", retries=attempts - 1, error=None)
        await store.documents_collection.update_one(
            security.owner_filter(owner_id, doc_id=doc_id),
            {"$set": {"status": "processing", "latest_job_id": job_id, "last_error": None, "updated_at": services.now_utc()}},
        )
        ingest_start = time.perf_counter()
        try:
            payload = await services.ingest_document_payload(owner_id, doc_id, filename, pdf_bytes)
            await _delete_existing_chunks(owner_id, doc_id)
            insert_result = await store.document_chunks_collection.insert_many(payload["chunks"])
            result = {
                "doc_id": doc_id,
                "filename": filename,
                "page_count": payload["page_count"],
                "chunk_count": len(insert_result.inserted_ids),
                "retrieval_mode": payload["retrieval_mode"],
                "embedding_stats": payload["embedding_stats"],
                "chunking": payload["chunking"],
                "ingest_ms": round((time.perf_counter() - ingest_start) * 1000, 1),
            }
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {
                    "$set": {
                        "status": "ready",
                        "page_count": payload["page_count"],
                        "chunk_count": len(insert_result.inserted_ids),
                        "retrieval_mode": payload["retrieval_mode"],
                        "summary": payload["summary"],
                        "embedding_stats": payload["embedding_stats"],
                        "graph_status": "idle",
                        "graph_cache": None,
                        "latest_job_id": job_id,
                        "last_error": None,
                        "updated_at": services.now_utc(),
                    }
                },
            )
            await _update_job(owner_id, job_id, status="completed", result=result, error=None)
            services.log_event(logging.INFO, "document_ingestion_completed", owner_id=owner_id, **result)
            return
        except HTTPException as exc:
            if attempts <= 2 and exc.status_code >= 500:
                services.log_event(logging.WARNING, "document_ingestion_retrying", owner_id=owner_id, doc_id=doc_id, attempt=attempts, detail=exc.detail)
                await asyncio.sleep(1.5 * attempts)
                continue
            detail = str(exc.detail)
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {"$set": {"status": "failed", "last_error": detail, "latest_job_id": job_id, "updated_at": services.now_utc()}},
            )
            await _update_job(owner_id, job_id, status="failed", error=detail, retries=attempts - 1)
            services.log_event(logging.ERROR, "document_ingestion_failed", owner_id=owner_id, doc_id=doc_id, detail=detail)
            return
        except Exception as exc:  # pragma: no cover - defensive background guard
            detail = str(exc)
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {"$set": {"status": "failed", "last_error": detail, "latest_job_id": job_id, "updated_at": services.now_utc()}},
            )
            await _update_job(owner_id, job_id, status="failed", error=detail, retries=attempts - 1)
            services.log_event(logging.ERROR, "document_ingestion_crashed", owner_id=owner_id, doc_id=doc_id, detail=detail)
            return


async def _run_graph_job(job_id: str, owner_id: str, doc_id: str) -> None:
    attempts = 0
    while True:
        attempts += 1
        await _update_job(owner_id, job_id, status="processing", retries=attempts - 1, error=None)
        await store.documents_collection.update_one(
            security.owner_filter(owner_id, doc_id=doc_id),
            {"$set": {"graph_status": "processing", "latest_job_id": job_id, "last_error": None, "updated_at": services.now_utc()}},
        )
        try:
            document = await _load_document(owner_id, doc_id)
            if document.get("status") != "ready":
                raise HTTPException(status_code=409, detail="Document is not ready for graph generation")
            chunks = await _load_document_chunks(owner_id, doc_id)
            paper_text = "\n\n".join(str(chunk.get("text", "")).strip() for chunk in chunks if str(chunk.get("text", "")).strip())[:60000]
            if not paper_text:
                raise HTTPException(status_code=400, detail="Document has no text available for graph generation")
            graph_data = await services.extract_graph_from_text(paper_text)
            result = {
                "doc_id": doc_id,
                "graph_data": graph_data,
                "paper_text": paper_text,
            }
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {
                    "$set": {
                        "graph_status": "ready",
                        "graph_cache": {
                            "graph_data": graph_data,
                            "paper_text": paper_text,
                            "generated_at": services.now_utc(),
                        },
                        "latest_job_id": job_id,
                        "last_error": None,
                        "updated_at": services.now_utc(),
                    }
                },
            )
            await _update_job(owner_id, job_id, status="completed", result=result, error=None)
            services.log_event(logging.INFO, "graph_generation_completed", owner_id=owner_id, doc_id=doc_id, nodes=len(graph_data.get("nodes", [])))
            return
        except HTTPException as exc:
            if attempts <= 2 and exc.status_code >= 500:
                services.log_event(logging.WARNING, "graph_generation_retrying", owner_id=owner_id, doc_id=doc_id, attempt=attempts, detail=exc.detail)
                await asyncio.sleep(1.5 * attempts)
                continue
            detail = str(exc.detail)
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {"$set": {"graph_status": "failed", "last_error": detail, "latest_job_id": job_id, "updated_at": services.now_utc()}},
            )
            await _update_job(owner_id, job_id, status="failed", error=detail, retries=attempts - 1)
            services.log_event(logging.ERROR, "graph_generation_failed", owner_id=owner_id, doc_id=doc_id, detail=detail)
            return
        except Exception as exc:  # pragma: no cover - defensive background guard
            detail = str(exc)
            await store.documents_collection.update_one(
                security.owner_filter(owner_id, doc_id=doc_id),
                {"$set": {"graph_status": "failed", "last_error": detail, "latest_job_id": job_id, "updated_at": services.now_utc()}},
            )
            await _update_job(owner_id, job_id, status="failed", error=detail, retries=attempts - 1)
            services.log_event(logging.ERROR, "graph_generation_crashed", owner_id=owner_id, doc_id=doc_id, detail=detail)
            return


def _spawn_job(job_id: str, coroutine: Any) -> None:
    task = asyncio.create_task(coroutine)
    ACTIVE_JOBS[job_id] = task

    def _cleanup(_task: asyncio.Task) -> None:
        ACTIVE_JOBS.pop(job_id, None)

    task.add_done_callback(_cleanup)


async def _document_lookup(owner_id: str, doc_ids: set[str]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for doc_id in doc_ids:
        doc = await store.documents_collection.find_one(security.owner_filter(owner_id, doc_id=doc_id), {"_id": 0, "doc_id": 1, "filename": 1})
        if doc:
            lookup[doc_id] = doc
    return lookup


@router.post("/upload", status_code=202)
async def upload_document(file: UploadFile = File(...), owner_id: str = Depends(security.get_owner_id)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    services.require_database()
    services.require_runtime_config()

    pdf_bytes = await file.read()
    doc_id = str(uuid.uuid4())
    metadata = await _insert_document_metadata(owner_id, doc_id, filename)
    job = await _create_job(owner_id, "document_ingestion", doc_id, max_retries=1)
    await store.documents_collection.update_one(
        security.owner_filter(owner_id, doc_id=doc_id),
        {"$set": {"latest_job_id": job["job_id"], "updated_at": services.now_utc()}},
    )
    services.log_event(logging.INFO, "document_upload_queued", filename=filename, owner_id=owner_id, doc_id=doc_id, job_id=job["job_id"])
    _spawn_job(job["job_id"], _run_ingestion_job(job["job_id"], owner_id, doc_id, filename, pdf_bytes))

    return {
        "message": f"Queued {filename} for background ingestion.",
        "doc_id": doc_id,
        "job_id": job["job_id"],
        "status": metadata["status"],
        "poll_interval_ms": config.JOB_POLL_INTERVAL_MS,
    }


@router.get("/jobs/{job_id}", response_model=models.JobStatusResponse)
async def get_job_status(job_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    job = await store.jobs_collection.find_one(security.owner_filter(owner_id, job_id=job_id), {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return models.JobStatusResponse(**job)


@router.get("/documents/{doc_id}", response_model=models.DocumentMetadataResponse)
async def get_document_metadata(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    document = await _load_document(owner_id, doc_id)
    return models.DocumentMetadataResponse(**document)


@router.get("/documents/{doc_id}/context", response_model=models.UploadedPaperContextResponse)
async def get_document_context(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    document = await _load_document(owner_id, doc_id)
    if document.get("status") != "ready":
        raise HTTPException(status_code=409, detail="Document is still processing")
    chunks = await _load_document_chunks(owner_id, doc_id)
    if not chunks:
        raise HTTPException(status_code=404, detail="Document not found")
    paper_text = "\n\n".join(str(chunk.get("text", "")).strip() for chunk in chunks if str(chunk.get("text", "")).strip())
    if not paper_text:
        raise HTTPException(status_code=400, detail="No text available for this document")
    return models.UploadedPaperContextResponse(
        doc_id=doc_id,
        filename=str(document.get("filename")) if document.get("filename") else None,
        paper_text=paper_text[:60000],
        page_count=int(document.get("page_count", 0)),
        chunk_count=len(chunks),
        status=str(document.get("status", "ready")),
    )


@router.post("/documents/{doc_id}/graph", status_code=202)
async def start_graph_generation(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    services.require_runtime_config()
    document = await _load_document(owner_id, doc_id)
    if document.get("status") != "ready":
        raise HTTPException(status_code=409, detail="Document is not ready for graph generation")
    if document.get("graph_status") == "ready" and document.get("graph_cache"):
        return {
            "message": "Graph cache already available.",
            "doc_id": doc_id,
            "status": "completed",
            "job_id": document.get("latest_job_id"),
            "poll_interval_ms": config.JOB_POLL_INTERVAL_MS,
        }

    job = await _create_job(owner_id, "graph_generation", doc_id, max_retries=1)
    await store.documents_collection.update_one(
        security.owner_filter(owner_id, doc_id=doc_id),
        {"$set": {"graph_status": "queued", "latest_job_id": job["job_id"], "updated_at": services.now_utc()}},
    )
    services.log_event(logging.INFO, "graph_generation_queued", owner_id=owner_id, doc_id=doc_id, job_id=job["job_id"])
    _spawn_job(job["job_id"], _run_graph_job(job["job_id"], owner_id, doc_id))
    return {
        "message": "Queued graph generation job.",
        "doc_id": doc_id,
        "job_id": job["job_id"],
        "status": "queued",
        "poll_interval_ms": config.JOB_POLL_INTERVAL_MS,
    }


@router.get("/documents/{doc_id}/graph")
async def get_document_graph(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    document = await _load_document(owner_id, doc_id)
    return {
        "doc_id": doc_id,
        "status": document.get("graph_status", "idle"),
        "job_id": document.get("latest_job_id"),
        "graph_cache": document.get("graph_cache"),
        "last_error": document.get("last_error"),
    }


@router.post("/query")
async def query_savant(request: models.QueryRequest, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    start_time = time.perf_counter()
    services.log_event(logging.INFO, "query_started", owner_id=owner_id, doc_id=request.doc_id, session_id=request.session_id, page_number=request.page_number)
    payment_info = None
    payment_verify_ms = 0.0

    if config.REQUIRE_SOLANA_PAYMENT:
        if not request.payment_signature or not request.payer_pubkey:
            raise HTTPException(status_code=402, detail="Payment required before querying")
        payment_start = time.perf_counter()
        existing = await store.payments_collection.find_one({"signature": request.payment_signature})
        if existing:
            raise HTTPException(status_code=402, detail="Payment signature already used")
        payment_info = await services.verify_solana_payment(request.payment_signature, request.payer_pubkey)
        payment_verify_ms = (time.perf_counter() - payment_start) * 1000
        await store.payments_collection.insert_one({**payment_info, "session_id": request.session_id, "doc_id": request.doc_id, "owner_id": owner_id, "created_at": services.now_utc()})

    active_document = None
    if request.doc_id:
        active_document = await _load_document(owner_id, request.doc_id)
        if active_document.get("status") != "ready":
            raise HTTPException(status_code=409, detail="Document is still processing")

    embed_start = time.perf_counter()
    query_embedding = None
    embed_ms = 0.0
    retrieval_mode = "hybrid"
    try:
        query_embedding = await services.embed_via_rest(request.prompt)
        embed_ms = (time.perf_counter() - embed_start) * 1000
    except HTTPException as exc:
        if exc.status_code == 429 and config.EMBED_ALLOW_LEXICAL_FALLBACK:
            retrieval_mode = "lexical_only"
            services.log_event(logging.WARNING, "query_retrieval_fallback_enabled", owner_id=owner_id, doc_id=request.doc_id, reason="embedding_rate_limit")
        else:
            raise

    vector_filter: dict = {"owner_id": {"$eq": owner_id}}
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
                    "filter": vector_filter,
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "doc_id": 1,
                    "page_number": 1,
                    "chunk_index": 1,
                    "text": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

    retrieval_start = time.perf_counter()
    vector_results = await store.document_chunks_collection.aggregate(pipeline).to_list(length=10) if pipeline else []
    filter_query = security.owner_filter(owner_id)
    if request.doc_id:
        filter_query["doc_id"] = request.doc_id
    if request.page_number is not None:
        filter_query["page_number"] = request.page_number
    fallback_docs = await store.document_chunks_collection.find(filter_query, {"_id": 0, "doc_id": 1, "page_number": 1, "chunk_index": 1, "text": 1}).to_list(length=2000)
    lexical_results = services.lexical_results_for_prompt(request.prompt, fallback_docs, limit=10) if fallback_docs else []
    merged_results = services.rerank_results(request.prompt, vector_results, lexical_results, limit=5)
    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

    doc_lookup = await _document_lookup(owner_id, {str(result.get("doc_id")) for result in merged_results if result.get("doc_id")})
    for result in merged_results:
        doc_meta = doc_lookup.get(str(result.get("doc_id")))
        if doc_meta:
            result["filename"] = doc_meta.get("filename")

    context_text = services.build_context_text(merged_results)
    full_prompt = (
        "You are Savant. Answer the user's prompt using ONLY the provided text context. "
        "Be concise, conversational, and include exact references like (page X).\n\n"
        f"Context:\n{context_text}\n\nUser Question:\n{request.prompt}"
    )

    llm_start = time.perf_counter()
    llm_fallback = False
    try:
        answer_text = await services.call_gemini(full_prompt, require_json=False)
    except HTTPException as exc:
        if exc.status_code == 429 and config.ALLOW_GENERATE_LOCAL_FALLBACK:
            llm_fallback = True
            answer_text = services.fallback_answer(request.prompt, context_text)
            services.log_event(logging.WARNING, "query_generation_fallback_enabled", owner_id=owner_id, doc_id=request.doc_id, reason="gemini_rate_limit")
        else:
            raise
    llm_ms = (time.perf_counter() - llm_start) * 1000

    audio_base64, tts_ms = await services.synthesize_audio(answer_text)
    citations = services.build_citations(merged_results, prompt=request.prompt)

    if request.session_id:
        session = await store.sessions_collection.find_one(security.owner_filter(owner_id, session_id=request.session_id))
        if session:
            now = services.now_utc()
            await store.messages_collection.insert_one(
                {
                    "session_id": request.session_id,
                    "owner_id": owner_id,
                    "doc_id": request.doc_id,
                    "prompt": request.prompt,
                    "answer": answer_text,
                    "citations": citations,
                    "payment_signature": request.payment_signature,
                    "created_at": now,
                }
            )
            await store.sessions_collection.update_one(security.owner_filter(owner_id, session_id=request.session_id), {"$set": {"updated_at": now}})

    total_ms = (time.perf_counter() - start_time) * 1000
    services.log_event(
        logging.INFO,
        "query_completed",
        owner_id=owner_id,
        doc_id=request.doc_id,
        session_id=request.session_id,
        retrieval_mode=retrieval_mode,
        llm_fallback=llm_fallback,
        citations=len(citations),
        context_chunks=len(merged_results),
        total_ms=round(total_ms, 1),
    )
    return {
        "answer": answer_text,
        "audio_base64": audio_base64,
        "context_used": [doc.get("chunk_index") for doc in merged_results],
        "citations": citations,
        "session_id": request.session_id,
        "payment": payment_info,
        "document_status": active_document.get("status") if active_document else None,
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
