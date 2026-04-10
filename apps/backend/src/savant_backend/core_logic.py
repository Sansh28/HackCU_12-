import re


def extract_retry_delay_seconds(error_data: dict | None, attempt: int, base_seconds: float, max_seconds: float) -> float:
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


def local_answer_from_context(prompt: str, context_text: str) -> str:
    if not context_text or context_text.strip() == "No relevant context found.":
        return (
            "Gemini quota is temporarily exhausted and no strong context match was found. "
            "Please retry shortly after quota resets."
        )

    tokens = [token for token in re.findall(r"[a-zA-Z0-9]+", prompt.lower()) if len(token) > 2]
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", context_text) if sentence.strip()]
    if not sentences:
        return "Gemini quota is temporarily exhausted. Please retry shortly."

    scored = []
    for sentence in sentences:
        lowered = sentence.lower()
        score = sum(lowered.count(token) for token in tokens) if tokens else 0
        scored.append((score, sentence))
    scored.sort(key=lambda item: item[0], reverse=True)

    picked = [sentence for _, sentence in scored[:3] if sentence]
    if not picked:
        picked = sentences[:2]

    summary = " ".join(picked)[:900]
    return f"Gemini quota is currently exhausted, so this is a context-only fallback answer: {summary}"


def would_create_cycle(graph: dict[str, list[str]], source: str, target: str) -> bool:
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


def enforce_dag_edges(nodes: list[dict], edges: list[dict]) -> list[dict]:
    valid_ids = {node["id"] for node in nodes}
    graph: dict[str, list[str]] = {node_id: [] for node_id in valid_ids}
    dag_edges: list[dict] = []

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
        if would_create_cycle(graph, source, target):
            continue
        graph[source].append(target)
        dag_edges.append(edge)

    return dag_edges


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    chunks: list[str] = []
    start = 0
    text_len = len(text)

    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunks.append(text[start:end])
        start += chunk_size - overlap

    return chunks


def fallback_chunks_for_prompt(prompt: str, docs: list[dict], limit: int = 5) -> list[dict]:
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


def hybrid_rerank(prompt: str, candidates: list[dict], limit: int = 5) -> list[dict]:
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
