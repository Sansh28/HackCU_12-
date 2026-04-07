import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

import backend_models as models
import backend_services as services
import backend_store as store
from backend_security import get_owner_id, owner_filter

router = APIRouter()


@router.post("/graph/extract")
async def graph_extract(request: models.GraphExtractRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for graph extraction")

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
        raw = await services.call_gemini(prompt, system_instruction=system_instruction, require_json=True)
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raw_retry = await services.call_gemini(prompt + "\n\nReturn pure JSON only.", system_instruction=system_instruction, require_json=True)
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for graph extraction") from exc
    return services.validate_graph_payload(parsed)


@router.post("/graph/use-cases")
async def graph_use_cases(request: models.GraphUseCasesRequest):
    paper_text = request.paper_text.strip()
    if not paper_text:
        raise HTTPException(status_code=400, detail="paper_text is required")
    if len(paper_text) < 200:
        raise HTTPException(status_code=400, detail="paper_text is too short for use-case extraction")

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
        raw = await services.call_gemini(prompt, system_instruction=system_instruction, require_json=True)
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        raw_retry = await services.call_gemini(prompt + "\n\nReturn pure JSON only.", system_instruction=system_instruction, require_json=True)
        try:
            parsed = json.loads(raw_retry)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="Gemini returned invalid JSON for use-case extraction") from exc
    return {"use_cases": services.validate_use_cases_payload(parsed)}


@router.post("/graph/sessions")
async def graph_create_session(request: models.GraphSessionCreateRequest, owner_id: str = Depends(get_owner_id)):
    services.require_database()
    session_id = str(uuid.uuid4())
    now = services.now_utc()
    session_doc = {
        "session_id": session_id,
        "owner_id": owner_id,
        "title": (request.title or "Paper Graph Session")[:120],
        "paper_context": (request.paper_context or "")[:8000],
        "created_at": now,
        "updated_at": now,
    }
    await store.graph_sessions_collection.insert_one(session_doc)
    return {"session_id": session_id, "title": session_doc["title"]}


@router.get("/graph/sessions/{session_id}")
async def graph_get_session(session_id: str, owner_id: str = Depends(get_owner_id)):
    services.require_database()
    session = await store.graph_sessions_collection.find_one(owner_filter(owner_id, session_id=session_id), {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Graph session not found")
    messages = await store.graph_messages_collection.find(owner_filter(owner_id, session_id=session_id), {"_id": 0}).sort("created_at", 1).to_list(length=2000)
    return {"session": session, "messages": messages}


@router.get("/graph/sessions/{session_id}/nodes/{node_id}/messages")
async def graph_get_node_messages(session_id: str, node_id: str, owner_id: str = Depends(get_owner_id)):
    services.require_database()
    messages = await store.graph_messages_collection.find(owner_filter(owner_id, session_id=session_id, node_id=node_id), {"_id": 0}).sort("created_at", 1).to_list(length=300)
    return {"messages": messages}


@router.post("/graph/ask")
async def graph_ask(request: models.GraphAskRequest, owner_id: str = Depends(get_owner_id)):
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
        await store.graph_sessions_collection.update_one(owner_filter(owner_id, session_id=request.session_id), {"$set": {"updated_at": now}})
    return {"answer": answer}
