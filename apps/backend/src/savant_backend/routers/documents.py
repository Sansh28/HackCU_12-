import time
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from savant_backend import config, models, security, store
from savant_backend.services import backend_services as services

router = APIRouter()


@router.post("/upload")
async def upload_document(file: UploadFile = File(...), owner_id: str = Depends(security.get_owner_id)):
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    services.require_database()

    ingest_start = time.perf_counter()
    pdf_bytes = await file.read()
    pages = services.extract_pages_from_pdf(pdf_bytes)
    if not pages:
        raise HTTPException(status_code=400, detail="No extractable text found in this PDF. If it is scanned, run OCR first.")

    doc_id = str(uuid.uuid4())
    insert_data = []
    capped = False
    lexical_fallback_triggered = False
    embedded_count = 0
    lexical_only_count = 0

    for page in pages:
        page_number = int(page["page_number"])
        page_chunks = [chunk for chunk in services.chunk_text(page["text"], chunk_size=config.UPLOAD_CHUNK_SIZE, overlap=config.UPLOAD_CHUNK_OVERLAP) if chunk.strip()]
        for page_chunk_index, chunk in enumerate(page_chunks):
            if len(insert_data) >= config.UPLOAD_MAX_CHUNKS:
                capped = True
                break
            try:
                embedding = await services.embed_via_rest(chunk)
                insert_data.append(
                    {
                        "owner_id": owner_id,
                        "doc_id": doc_id,
                        "filename": filename,
                        "page_number": page_number,
                        "chunk_index": page_chunk_index,
                        "text": chunk,
                        "embedding": embedding,
                    }
                )
                embedded_count += 1
            except HTTPException as exc:
                if exc.status_code == 429 and config.EMBED_ALLOW_LEXICAL_FALLBACK:
                    lexical_fallback_triggered = True
                    insert_data.append(
                        {
                            "owner_id": owner_id,
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

    insert_result = await store.documents_collection.insert_many(insert_data)
    retrieval_mode = "lexical_only" if lexical_fallback_triggered and embedded_count == 0 else ("hybrid" if embedded_count > 0 else "lexical_only")
    return {
        "message": f"Successfully processed {filename}.",
        "doc_id": doc_id,
        "chunks_processed": len(insert_data),
        "chunks_stored": len(insert_result.inserted_ids),
        "page_count": len(pages),
        "chunking": {
            "chunk_size": config.UPLOAD_CHUNK_SIZE,
            "chunk_overlap": config.UPLOAD_CHUNK_OVERLAP,
            "max_chunks": config.UPLOAD_MAX_CHUNKS,
            "capped": capped,
        },
        "retrieval_mode": retrieval_mode,
        "embedding_stats": {
            "embedded_chunks": embedded_count,
            "lexical_only_chunks": lexical_only_count,
            "lexical_fallback_triggered": lexical_fallback_triggered,
        },
        "telemetry": {"ingest_ms": round((time.perf_counter() - ingest_start) * 1000, 1)},
    }


@router.get("/documents/{doc_id}/context", response_model=models.UploadedPaperContextResponse)
async def get_document_context(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    docs = await store.documents_collection.find(
        security.owner_filter(owner_id, doc_id=doc_id),
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
    return models.UploadedPaperContextResponse(
        doc_id=doc_id,
        filename=filename,
        paper_text=paper_text[:60000],
        page_count=page_count,
        chunk_count=len(docs),
    )


@router.post("/query")
async def query_savant(request: models.QueryRequest, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    start_time = time.perf_counter()
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

    if request.doc_id:
        existing_doc = await store.documents_collection.find_one(security.owner_filter(owner_id, doc_id=request.doc_id), {"_id": 1})
        if not existing_doc:
            raise HTTPException(status_code=404, detail="Document not found")

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
                    "filename": 1,
                    "page_number": 1,
                    "chunk_index": 1,
                    "text": 1,
                    "score": {"$meta": "vectorSearchScore"},
                }
            },
        ]

    retrieval_start = time.perf_counter()
    vector_results = await store.documents_collection.aggregate(pipeline).to_list(length=10) if pipeline else []
    filter_query = security.owner_filter(owner_id)
    if request.doc_id:
        filter_query["doc_id"] = request.doc_id
    if request.page_number is not None:
        filter_query["page_number"] = request.page_number
    fallback_docs = await store.documents_collection.find(filter_query, {"_id": 0, "doc_id": 1, "filename": 1, "page_number": 1, "chunk_index": 1, "text": 1}).to_list(length=2000)
    lexical_results = services.lexical_results_for_prompt(request.prompt, fallback_docs, limit=10) if fallback_docs else []
    merged_results = services.rerank_results(request.prompt, vector_results, lexical_results, limit=5)
    retrieval_ms = (time.perf_counter() - retrieval_start) * 1000

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
        else:
            raise
    llm_ms = (time.perf_counter() - llm_start) * 1000

    audio_base64, tts_ms = await services.synthesize_audio(answer_text)
    citations = services.build_citations(merged_results)

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
