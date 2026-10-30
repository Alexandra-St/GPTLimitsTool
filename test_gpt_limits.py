import unittest

from gpt_limits import analyze, render_report


class AnalyzeTests(unittest.TestCase):
    def test_empty_history(self):
        report = analyze({"title": "Empty", "conversation_id": "c1", "messages": []})
        self.assertEqual(report["messages"], 0)
        self.assertEqual(report["user_messages"], 0)
        self.assertEqual(report["assistant_messages"], 0)
        self.assertEqual(report["estimated_text_tokens"], 0)
        self.assertEqual(report["history_complete"], "Unknown")

    def test_roles_internal_content_and_attachments(self):
        report = analyze(
            {
                "title": "Sample",
                "conversation_id": "sample-id",
                "messages": [
                    {"id": "u1", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["Hi", {"content_type": "image", "image": {"url": "local-reference"}}]}},
                    {"id": "a1", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["Hello!"]}},
                    {"id": "a2", "author": {"role": "assistant"}, "metadata": {"channel": "analysis"}, "content": {"content_type": "text", "parts": ["private internal text"]}},
                    {"id": "tool1", "author": {"role": "python"}, "content": {"content_type": "file", "file": {"name": "result.csv"}}},
                    {"id": "u1", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["duplicate"]}},
                ],
                "page_info": {"has_previous_page": True, "has_next_page": False},
            }
        )
        self.assertEqual(report["messages"], 4)
        self.assertEqual(report["user_messages"], 1)
        self.assertEqual(report["assistant_messages"], 2)
        self.assertEqual(report["images"], 1)
        self.assertEqual(report["other_attachments"], 1)
        self.assertEqual(report["history_complete"], "No")
        self.assertNotIn("private internal text", render_report(report))
        self.assertGreater(report["estimated_text_tokens"], 0)

    def test_page_without_more_pages_is_still_unknown_without_confirmation(self):
        report = analyze({"messages": [], "page_info": {"has_previous_page": False, "has_next_page": False}})
        self.assertEqual(report["history_complete"], "Unknown")

    def test_explicitly_confirmed_history(self):
        report = analyze({"messages": [], "history_complete": True})
        self.assertEqual(report["history_complete"], "Yes")

    def test_invalid_shapes_are_rejected(self):
        with self.assertRaises(ValueError):
            analyze({"messages": {}})
        with self.assertRaises(ValueError):
            analyze([])


if __name__ == "__main__":
    unittest.main()
