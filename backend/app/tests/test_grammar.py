"""Run with: python -m unittest discover -s app/tests -p test_grammar.py"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app.auth import create_token
from app.config import settings
from app.main import app
from app.models import database
from app.services import grammar


TEXT = "何か 悪いことしたの？"
RESULT = {
    "sentence": TEXT,
    "translation": "你做了什么坏事吗？",
    "summary": "省略主语的口语疑问句，句末的の要求解释。",
    "segments": [
        {"text": "何か ", "role": "不定代词", "explanation": "指不确定的事情，修饰后面的宾语。"},
        {"text": "悪いこと", "role": "宾语", "explanation": "形容词悪い修饰こと，口语中省略宾格助词を。"},
        {"text": "した", "role": "动词过去式", "explanation": "する的た形，表示已发生的动作。"},
        {"text": "の？", "role": "解释性疑问", "explanation": "句末の带有要求对方说明原因或情况的语气。"},
    ],
}


class FakeStream:
    def __init__(self, content):
        self.content = content

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def __aiter__(self):
        # Include an empty usage chunk, as real providers sometimes do.
        yield SimpleNamespace(choices=[])
        for part in (self.content[:30], self.content[30:]):
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=part))])


class GrammarTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "_db_path", str(Path(self.temp.name) / "grammar.db"))
        self.db_patch.start()
        self.key_patch = patch.object(settings, "DEEPSEEK_API_KEY", "test-only-placeholder")
        self.key_patch.start()
        await database.init_db()
        self.client = SimpleNamespace()
        self.create = AsyncMock(return_value=FakeStream(json.dumps(RESULT, ensure_ascii=False)))
        self.client.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))
        self.manager = AsyncMock()
        self.manager.__aenter__.return_value = self.client
        self.sdk_patch = patch.object(grammar, "AsyncOpenAI", return_value=self.manager)
        self.sdk = self.sdk_patch.start()

    async def asyncTearDown(self):
        pending = list(grammar._inflight.values())
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        grammar._inflight.clear()
        self.sdk_patch.stop()
        self.key_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    async def test_streamed_analysis_preserves_sentence_and_uses_deepseek(self):
        result = await grammar.analyze_grammar(TEXT)
        self.assertEqual(result.model_dump(), RESULT)
        self.assertEqual("".join(item.text for item in result.segments), TEXT)
        self.assertEqual(self.sdk.call_args.kwargs["base_url"], settings.DEEPSEEK_BASE_URL)
        self.assertEqual(self.create.call_args.kwargs["model"], settings.DEEPSEEK_MODEL)
        self.assertTrue(self.create.call_args.kwargs["stream"])
        self.assertEqual(self.create.call_args.kwargs["response_format"], {"type": "json_object"})
        self.assertEqual(self.create.call_args.kwargs["extra_body"], {"thinking": {"type": "disabled"}})
        messages = self.create.call_args.kwargs["messages"]
        self.assertEqual(json.loads(messages[1]["content"])["text"], TEXT)

    async def test_success_is_persisted_and_can_be_read_without_api_key(self):
        await grammar.analyze_grammar(TEXT)
        with patch.object(settings, "DEEPSEEK_API_KEY", ""):
            result = await grammar.analyze_grammar(TEXT)
        self.assertEqual(result.sentence, TEXT)
        self.create.assert_awaited_once()

    async def test_fenced_json_is_accepted(self):
        self.create.return_value = FakeStream("```json\n" + json.dumps(RESULT) + "\n```")
        self.assertEqual((await grammar.analyze_grammar(TEXT)).sentence, TEXT)

    async def test_invalid_json_is_not_cached_and_retry_can_succeed(self):
        self.create.return_value = FakeStream("This is not a JSON analysis")
        with self.assertRaises(HTTPException) as failure:
            await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)
        self.create.return_value = FakeStream(json.dumps(RESULT))
        self.assertEqual((await grammar.analyze_grammar(TEXT)).sentence, TEXT)
        self.assertEqual(self.create.await_count, 2)

    async def test_modified_or_partial_sentence_is_rejected(self):
        changed = dict(RESULT, segments=RESULT["segments"][:-1])
        self.create.return_value = FakeStream(json.dumps(changed))
        with self.assertRaises(HTTPException) as failure:
            await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)

    async def test_missing_configuration_returns_actionable_503(self):
        with patch.object(settings, "DEEPSEEK_API_KEY", ""):
            with self.assertRaises(HTTPException) as failure:
                await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 503)
        self.assertIn("DeepSeek", failure.exception.detail)
        self.create.assert_not_awaited()

    async def test_upstream_failure_does_not_expose_provider_message(self):
        self.create.side_effect = RuntimeError("private-provider-details-and-secret")
        with self.assertRaises(HTTPException) as failure:
            await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertNotIn("private", failure.exception.detail)

    async def test_provider_timeout_returns_retryable_504(self):
        self.create.side_effect = grammar.APITimeoutError(request=httpx.Request("POST", "https://api.example.test"))
        with self.assertRaises(HTTPException) as failure:
            await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 504)

    async def test_same_sentence_concurrency_uses_one_generation(self):
        gate = asyncio.Event()

        async def create(**_):
            await gate.wait()
            return FakeStream(json.dumps(RESULT))

        self.create.side_effect = create
        requests = [asyncio.create_task(grammar.analyze_grammar(TEXT)) for _ in range(3)]
        for _ in range(100):
            if self.create.await_count:
                break
            await asyncio.sleep(0.005)
        gate.set()
        results = await asyncio.gather(*requests)
        self.assertEqual(len(results), 3)
        self.create.assert_awaited_once()

    async def test_closing_one_request_does_not_cancel_shared_generation(self):
        started = asyncio.Event()
        gate = asyncio.Event()

        async def create(**_):
            started.set()
            await gate.wait()
            return FakeStream(json.dumps(RESULT))

        self.create.side_effect = create
        closed = asyncio.create_task(grammar.analyze_grammar(TEXT))
        await asyncio.wait_for(started.wait(), timeout=2)
        closed.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await closed
        remaining = asyncio.create_task(grammar.analyze_grammar(TEXT))
        gate.set()
        self.assertEqual((await remaining).sentence, TEXT)
        self.create.assert_awaited_once()

    async def test_concurrency_limit_returns_429_without_calling_provider(self):
        blocker = asyncio.create_task(asyncio.sleep(60))
        grammar._inflight.update({str(index): blocker for index in range(grammar.MAX_CONCURRENT_ANALYSES)})
        with self.assertRaises(HTTPException) as failure:
            await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 429)
        self.create.assert_not_awaited()

    async def test_http_authentication_input_validation_and_result(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            unauthenticated = await client.post("/api/analysis/grammar", json={"text": TEXT})
            self.assertIn(unauthenticated.status_code, (401, 403))
            headers = {"Authorization": "Bearer " + create_token(settings.AUTH_PASSWORD)}
            for text in ("", "   ", "日" * 2001):
                response = await client.post("/api/analysis/grammar", json={"text": text}, headers=headers)
                self.assertEqual(response.status_code, 422)
            response = await client.post("/api/analysis/grammar", json={"text": TEXT}, headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), RESULT)


if __name__ == "__main__":
    unittest.main()
