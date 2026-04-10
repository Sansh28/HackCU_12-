import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

try:
    import httpx
    from savant_backend import store
    from savant_backend.main import app
    from savant_backend.services import backend_services as services
except Exception as exc:  # pragma: no cover - environment dependency guard
    raise unittest.SkipTest(f"API flow tests require a working FastAPI/httpx runtime: {exc}")


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, field, direction):
        reverse = direction == -1
        self.docs.sort(key=lambda item: item.get(field), reverse=reverse)
        return self

    async def to_list(self, length=0):
        if length:
            return self.docs[:length]
        return list(self.docs)


class FakeCollection:
    def __init__(self):
        self.docs = []

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return self._project(doc, projection)
        return None

    def find(self, query, projection=None):
        matched = [self._project(doc, projection) for doc in self.docs if all(doc.get(key) == value for key, value in query.items())]
        return FakeCursor(matched)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=len(self.docs))

    async def insert_many(self, docs):
        for doc in docs:
            self.docs.append(dict(doc))
        return SimpleNamespace(inserted_ids=list(range(len(self.docs) - len(docs), len(self.docs))))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if all(doc.get(key) == value for key, value in query.items()):
                updated = dict(doc)
                updated.update(update.get("$set", {}))
                self.docs[index] = updated
                return SimpleNamespace(matched_count=1, deleted_count=0)
        if upsert:
            new_doc = dict(query)
            new_doc.update(update.get("$setOnInsert", {}))
            new_doc.update(update.get("$set", {}))
            self.docs.append(new_doc)
            return SimpleNamespace(matched_count=1, deleted_count=0)
        return SimpleNamespace(matched_count=0, deleted_count=0)

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if all(doc.get(key) == value for key, value in query.items()):
                self.docs.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def aggregate(self, pipeline):
        docs = self.docs
        if pipeline:
            vector_filter = pipeline[0]["$vectorSearch"].get("filter", {})
            for field, expected in vector_filter.items():
                docs = [doc for doc in docs if doc.get(field) == expected["$eq"]]
        projected = []
        for doc in docs[:10]:
            projected.append(
                {
                    "doc_id": doc.get("doc_id"),
                    "filename": doc.get("filename"),
                    "page_number": doc.get("page_number"),
                    "chunk_index": doc.get("chunk_index"),
                    "text": doc.get("text"),
                    "score": doc.get("score", 0.8),
                }
            )
        return FakeCursor(projected)

    @staticmethod
    def _project(doc, projection):
        if not projection:
            return dict(doc)
        return {key: value for key, value in doc.items() if projection.get(key)}


class ApiFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_collections = {
            "client": store.client,
            "documents_collection": store.documents_collection,
            "payments_collection": store.payments_collection,
            "sessions_collection": store.sessions_collection,
            "messages_collection": store.messages_collection,
            "graph_sessions_collection": store.graph_sessions_collection,
            "graph_messages_collection": store.graph_messages_collection,
            "chat_conversations_collection": store.chat_conversations_collection,
        }
        store.client = object()
        store.documents_collection = FakeCollection()
        store.payments_collection = FakeCollection()
        store.sessions_collection = FakeCollection()
        store.messages_collection = FakeCollection()
        store.graph_sessions_collection = FakeCollection()
        store.graph_messages_collection = FakeCollection()
        store.chat_conversations_collection = FakeCollection()
        self.transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=self.transport, base_url="http://testserver")

    async def asyncTearDown(self):
        await self.client.aclose()
        for name, value in self.original_collections.items():
            setattr(store, name, value)

    async def test_upload_query_and_session_flow(self):
        async def fake_embed(_text):
            return [0.1, 0.2, 0.3]

        async def fake_call_gemini(_prompt, system_instruction=None, require_json=False):
            return "Synthesized answer from context."

        with (
            patch.object(services, "extract_pages_from_pdf", return_value=[{"page_number": 1, "text": "Transformer models use attention and positional encoding."}]),
            patch.object(services, "embed_via_rest", side_effect=fake_embed),
            patch.object(services, "call_gemini", side_effect=fake_call_gemini),
            patch.object(services, "synthesize_audio", return_value=(None, 0.0)),
        ):
            upload = await self.client.post(
                "/upload",
                headers={"X-Savant-Owner": "owner-a"},
                files={"file": ("paper.pdf", b"%PDF-1.4 fake", "application/pdf")},
            )
            self.assertEqual(upload.status_code, 200)
            doc_id = upload.json()["doc_id"]

            create_session = await self.client.post("/sessions", headers={"X-Savant-Owner": "owner-a"}, json={"doc_id": doc_id, "title": "My Session"})
            self.assertEqual(create_session.status_code, 200)
            session_id = create_session.json()["session_id"]

            query = await self.client.post(
                "/query",
                headers={"X-Savant-Owner": "owner-a"},
                json={"prompt": "What does the paper use?", "doc_id": doc_id, "session_id": session_id},
            )
            self.assertEqual(query.status_code, 200)
            self.assertEqual(query.json()["answer"], "Synthesized answer from context.")

            session = await self.client.get(f"/sessions/{session_id}", headers={"X-Savant-Owner": "owner-a"})
            self.assertEqual(session.status_code, 200)
            self.assertEqual(len(session.json()["messages"]), 1)

    async def test_owner_isolation_blocks_cross_user_access(self):
        now = services.now_utc()
        store.sessions_collection.docs.append(
            {
                "session_id": "session-1",
                "owner_id": "owner-a",
                "share_token": "share-1",
                "title": "Private Session",
                "created_at": now,
                "updated_at": now,
            }
        )

        response = await self.client.get("/sessions/session-1", headers={"X-Savant-Owner": "owner-b"})

        self.assertEqual(response.status_code, 404)

    async def test_conversation_state_requires_owner_header(self):
        response = await self.client.post(
            "/chat/conversations/conv-1/state",
            json={"title": "Missing Owner", "logs": []},
        )

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
