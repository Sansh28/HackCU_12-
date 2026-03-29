import unittest

from core_logic import chunk_text, enforce_dag_edges, extract_retry_delay_seconds, local_answer_from_context


class BackendCoreLogicTests(unittest.TestCase):
    def test_chunk_text_respects_overlap(self):
        chunks = chunk_text("abcdefghijklmnopqrstuvwxyz", chunk_size=10, overlap=3)

        self.assertEqual(chunks[0], "abcdefghij")
        self.assertEqual(chunks[1], "hijklmnopq")
        self.assertTrue(chunks[-1].endswith("z"))

    def test_extract_retry_delay_uses_api_hint_when_present(self):
        error_data = {"error": {"details": [{"retryDelay": "7s"}]}}

        delay = extract_retry_delay_seconds(error_data, attempt=1, base_seconds=1.5, max_seconds=20.0)

        self.assertEqual(delay, 7.0)

    def test_extract_retry_delay_falls_back_to_exponential_backoff(self):
        delay = extract_retry_delay_seconds({}, attempt=2, base_seconds=1.5, max_seconds=20.0)

        self.assertEqual(delay, 6.0)

    def test_enforce_dag_edges_removes_cycles(self):
        nodes = [
            {"id": "a", "importance": 5},
            {"id": "b", "importance": 4},
            {"id": "c", "importance": 3},
        ]
        edges = [
            {"source": "a", "target": "b", "label": "supports"},
            {"source": "b", "target": "c", "label": "supports"},
            {"source": "c", "target": "a", "label": "cycles"},
        ]

        dag_edges = enforce_dag_edges(nodes, edges)

        self.assertEqual(len(dag_edges), 2)
        self.assertNotIn({"source": "c", "target": "a", "label": "cycles"}, dag_edges)

    def test_local_answer_fallback_prefers_matching_sentences(self):
        prompt = "What does the transformer use for sequence order?"
        context = (
            "The model replaces recurrence with attention. "
            "Positional encoding is injected so the transformer can represent token order. "
            "Training remained efficient."
        )

        answer = local_answer_from_context(prompt, context)

        self.assertIn("context-only fallback answer", answer)
        self.assertIn("Positional encoding", answer)


if __name__ == "__main__":
    unittest.main()
