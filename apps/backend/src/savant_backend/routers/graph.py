import uuid

from fastapi import APIRouter, Depends, HTTPException

from savant_backend import models, security, store
from savant_backend.services import backend_services as services

router = APIRouter()


@router.post("/graph/extract")
async def graph_extract(request: models.GraphExtractRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for graph extraction")

    return await services.extract_graph_from_text(paper_text)


@router.post("/graph/use-cases")
async def graph_use_cases(request: models.GraphUseCasesRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for use-case extraction")

    return {"use_cases": await services.extract_use_cases_from_text(paper_text)}


@router.post("/graph/sessions")
async def graph_create_session(request: models.GraphSessionCreateRequest, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    if request.doc_id:
        existing = await store.graph_sessions_collection.find_one(security.owner_filter(owner_id, doc_id=request.doc_id), {"_id": 0})
        if existing:
            return {
                "session_id": existing["session_id"],
                "title": existing.get("title", "Paper Graph Session"),
                "doc_id": existing.get("doc_id"),
                "bookmarks": existing.get("bookmarks", []),
                "saved_insights": existing.get("saved_insights", []),
                "node_notes": existing.get("node_notes", {}),
                "selected_node_id": existing.get("selected_node_id"),
            }
    session_id = str(uuid.uuid4())
    now = services.now_utc()
    graph_cache = None
    if request.doc_id:
        document = await store.documents_collection.find_one(security.owner_filter(owner_id, doc_id=request.doc_id), {"graph_cache": 1, "filename": 1})
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        graph_cache = document.get("graph_cache")
    session_doc = {
        "session_id": session_id,
        "owner_id": owner_id,
        "doc_id": request.doc_id,
        "title": (request.title or "Paper Graph Session")[:120],
        "paper_context": (request.paper_context or "")[:8000],
        "graph_cache": graph_cache,
        "bookmarks": [],
        "saved_insights": [],
        "node_notes": {},
        "selected_node_id": None,
        "created_at": now,
        "updated_at": now,
    }
    await store.graph_sessions_collection.insert_one(session_doc)
    return {"session_id": session_id, "title": session_doc["title"], "doc_id": request.doc_id, "bookmarks": [], "saved_insights": [], "node_notes": {}, "selected_node_id": None}


@router.get("/graph/workspaces/by-document/{doc_id}")
async def graph_get_workspace_by_document(doc_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    workspace = await store.graph_sessions_collection.find_one(security.owner_filter(owner_id, doc_id=doc_id), {"_id": 0})
    if not workspace:
        raise HTTPException(status_code=404, detail="Graph workspace not found")
    return {"workspace": workspace}


@router.get("/graph/sessions/{session_id}")
async def graph_get_session(session_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    session = await store.graph_sessions_collection.find_one(security.owner_filter(owner_id, session_id=session_id), {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Graph session not found")
    messages = await store.graph_messages_collection.find(security.owner_filter(owner_id, session_id=session_id), {"_id": 0}).sort("created_at", 1).to_list(length=2000)
    return {"session": session, "messages": messages}


@router.patch("/graph/sessions/{session_id}")
async def graph_update_session(
    session_id: str,
    request: models.GraphWorkspaceUpdateRequest,
    owner_id: str = Depends(security.get_owner_id),
):
    services.require_database()
    now = services.now_utc()
    update_doc = {
        "selected_node_id": request.selected_node_id,
        "bookmarks": request.bookmarks[:40],
        "saved_insights": [item.strip()[:320] for item in request.saved_insights if item.strip()][:50],
        "node_notes": {key[:80]: value[:1200] for key, value in request.node_notes.items() if value.strip()},
        "updated_at": now,
    }
    result = await store.graph_sessions_collection.update_one(
        security.owner_filter(owner_id, session_id=session_id),
        {"$set": update_doc},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Graph session not found")
    return {"ok": True}


@router.get("/graph/sessions/{session_id}/nodes/{node_id}/messages")
async def graph_get_node_messages(session_id: str, node_id: str, owner_id: str = Depends(security.get_owner_id)):
    services.require_database()
    messages = await store.graph_messages_collection.find(security.owner_filter(owner_id, session_id=session_id, node_id=node_id), {"_id": 0}).sort("created_at", 1).to_list(length=300)
    return {"messages": messages}


@router.post("/graph/ask")
async def graph_ask(request: models.GraphAskRequest, owner_id: str = Depends(security.get_owner_id)):
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
    system_instruction = "You are a precise research paper tutor. Use only the provided paper context. If context is insufficient, say so explicitly."
    prompt = (
        f"Concept: {request.concept}\n"
        f"Question: {request.question}\n\n"
        f"Conversation history:\n{history_text or '(none)'}\n\n"
        f"Paper context:\n{request.paper_context[:25000]}\n\n"
        "Answer clearly in 4-8 sentences."
    )

    answer = await services.call_gemini(prompt, system_instruction=system_instruction, require_json=False)
    if request.session_id and request.node_id and store.client:
        now = services.now_utc()
        await store.graph_messages_collection.insert_many(
            [
                {
                    "session_id": request.session_id,
                    "owner_id": owner_id,
                    "node_id": request.node_id,
                    "concept": request.concept,
                    "role": "user",
                    "content": request.question.strip(),
                    "created_at": now,
                },
                {
                    "session_id": request.session_id,
                    "owner_id": owner_id,
                    "node_id": request.node_id,
                    "concept": request.concept,
                    "role": "assistant",
                    "content": answer,
                    "created_at": now,
                },
            ]
        )
        await store.graph_sessions_collection.update_one(security.owner_filter(owner_id, session_id=request.session_id), {"$set": {"updated_at": now}})
    return {"answer": answer}
