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
