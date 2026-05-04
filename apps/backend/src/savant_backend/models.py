from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


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
    doc_id: str | None = None


class GraphWorkspaceUpdateRequest(BaseModel):
    selected_node_id: str | None = None
    bookmarks: list[str] = Field(default_factory=list)
    saved_insights: list[str] = Field(default_factory=list)
    node_notes: dict[str, str] = Field(default_factory=dict)


class UploadedPaperContextResponse(BaseModel):
    doc_id: str
    filename: str | None = None
    paper_text: str
    page_count: int
    chunk_count: int
    status: str = "ready"


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


class AuthSessionResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    owner_id: str
    expires_at: int


class DocumentMetadataResponse(BaseModel):
    doc_id: str
    owner_id: str
    filename: str
    status: Literal["queued", "processing", "ready", "failed"]
    page_count: int = 0
    chunk_count: int = 0
    retrieval_mode: str = "pending"
    summary: str | None = None
    embedding_stats: dict[str, Any] = Field(default_factory=dict)
    graph_status: Literal["idle", "queued", "processing", "ready", "failed"] = "idle"
    graph_cache: dict[str, Any] | None = None
    latest_job_id: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class JobStatusResponse(BaseModel):
    job_id: str
    job_type: Literal["document_ingestion", "graph_generation"]
    doc_id: str | None = None
    owner_id: str
    status: Literal["queued", "processing", "completed", "failed"]
    retries: int = 0
    max_retries: int = 0
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


VALID_GRAPH_CATEGORIES = {"foundation", "method", "result", "component", "concept"}
