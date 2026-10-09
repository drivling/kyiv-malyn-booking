"""Юніт-тести чистих функцій парсера: python3 -m unittest viberparser/test_parser.py"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import parser as p  # noqa: E402


class BatchingTests(unittest.TestCase):
    def test_chunked_splits_by_size(self):
        self.assertEqual(list(p.chunked(list(range(5)), 2)), [[0, 1], [2, 3], [4]])
        self.assertEqual(list(p.chunked([], 2)), [])

    def test_bulk_posts_array_and_reads_counts(self):
        captured = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps({"created": 2, "duplicates": 1, "errors": [{"index": 3}]}).encode()

        def fake_urlopen(req, timeout):
            captured["url"] = req.full_url
            captured["body"] = json.loads(req.data.decode("utf-8"))
            captured["auth"] = req.get_header("Authorization")
            return Resp()

        with mock.patch.object(p.request, "urlopen", fake_urlopen):
            created, dups, errors = p.send_raw_messages_bulk("https://api/", "tok", ["a", "b"])
        self.assertEqual((created, dups, len(errors)), (2, 1, 1))
        self.assertEqual(captured["url"], "https://api/viber-listings/bulk")
        self.assertEqual(captured["body"], {"rawMessages": ["a", "b"]})
        self.assertEqual(captured["auth"], "tok")


class StateTests(unittest.TestCase):
    def test_clean_state_drops_junk_and_foreign_paths(self):
        with tempfile.NamedTemporaryFile(suffix=".db") as db:
            good = f"{db.name}::1::post_timestamp"
            state = {
                good: 123,
                f"{db.name}::1": 439,  # старий ключ без суфікса
                "/Users/someone-else/viber.db::2::post_timestamp": 5,  # чужий шлях
            }
            self.assertEqual(p.clean_state(state), {good: 123})


if __name__ == "__main__":
    unittest.main()
