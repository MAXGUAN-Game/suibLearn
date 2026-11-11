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
    def __init__(self, content, finish_reason="stop"):
        self.content = content
        self.finish_reason = finish_reason

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def __aiter__(self):
        # Include an empty usage chunk, as real providers sometimes do.
        yield SimpleNamespace(choices=[])
        for part in (self.content[:30], self.content[30:]):
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=part))])
        yield SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content=None), finish_reason=self.finish_reason,
        )])


def analysis_for(text, pieces):
    return {
        "sentence": text,
        "translation": "自然中文译文",
        "summary": "整句语法解释",
        "segments": [{"text": piece, "role": "语法成分", "explanation": "该成分在本句的语法作用。"} for piece in pieces],
    }


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

    async def test_english_phrase_boundaries_restore_only_original_spaces_and_cache(self):
        text = "I've wanted to tell her off for the last six weeks."
        pieces = ["I've", "wanted", "to tell her off", "for the last six weeks", "."]
        self.create.return_value = FakeStream(json.dumps(analysis_for(text, pieces)))
        result = await grammar.analyze_grammar(text)
        self.assertEqual(result.sentence, text)
        self.assertEqual([segment.text for segment in result.segments], [
            "I've", " wanted", " to tell her off", " for the last six weeks", ".",
        ])
        self.assertEqual("".join(segment.text for segment in result.segments), text)
        cached = await grammar.analyze_grammar(text)
        self.assertEqual(cached.model_dump(), result.model_dump())
        self.create.assert_awaited_once()

    async def test_original_double_spaces_newline_and_edge_whitespace_are_preserved(self):
        text = "  I've  wanted\nto tell her off. \t"
        reply = analysis_for(text, ["I've", "wanted", "to tell her off", "."])
        result = grammar._validate_analysis(json.dumps(reply), text)
        self.assertEqual([segment.text for segment in result.segments], [
            "  I've", "  wanted", "\nto tell her off", ". \t",
        ])
        self.assertEqual("".join(segment.text for segment in result.segments), text)

    async def test_existing_whitespace_in_segments_is_not_duplicated(self):
        text = "I've  wanted to tell her off."
        reply = analysis_for(text, ["I've ", " wanted ", "to tell her off."])
        result = grammar._validate_analysis(json.dumps(reply), text)
        self.assertEqual("".join(segment.text for segment in result.segments), text)
        self.assertEqual([segment.text for segment in result.segments], ["I've ", " wanted ", "to tell her off."])

    async def test_internal_whitespace_changes_are_not_repaired(self):
        text = "I've wanted to  tell her off."
        reply = analysis_for(text, ["I've", "wanted", "to tell her off", "."])
        with self.assertRaises(grammar.AnalysisFormatError):
            grammar._validate_analysis(json.dumps(reply), text)

    async def test_repeated_words_are_matched_in_order_without_skipping(self):
        text = "She had had enough."
        reply = analysis_for(text, ["She", "had", "had", "enough", "."])
        result = grammar._validate_analysis(json.dumps(reply), text)
        self.assertEqual("".join(segment.text for segment in result.segments), text)
        reply["segments"].pop(2)
        with self.assertRaises(grammar.AnalysisFormatError):
            grammar._validate_analysis(json.dumps(reply), text)

    async def test_missing_word_punctuation_or_changed_characters_are_rejected(self):
        text = "I've wanted to tell her off for the last six weeks."
        for pieces in (
            ["I've", "wanted", "to tell off", "for the last six weeks", "."],
            ["I've", "wanted", "to tell her off", "for the last six weeks"],
            ["I've", "wanted", "to tell her of", "for the last six weeks", "."],
            ["I’ve", "wanted", "to tell her off", "for the last six weeks", "."],
            ["wanted", "I've", "to tell her off", "for the last six weeks", "."],
        ):
            with self.subTest(pieces=pieces):
                with self.assertRaises(grammar.AnalysisFormatError):
                    grammar._validate_analysis(json.dumps(analysis_for(text, pieces)), text)

    async def test_sentence_field_must_still_match_verbatim(self):
        reply = dict(RESULT, sentence=TEXT.replace("何か ", "何か"))
        with self.assertRaises(grammar.AnalysisFormatError) as failure:
            grammar._validate_analysis(json.dumps(reply), TEXT)
        self.assertEqual(failure.exception.reason, "sentence_mismatch")

    async def test_truncated_stream_is_rejected_even_if_json_is_valid_and_not_cached(self):
        self.create.return_value = FakeStream(json.dumps(RESULT), finish_reason="length")
        with self.assertLogs(grammar.logger, level="WARNING") as captured:
            with self.assertRaises(HTTPException) as failure:
                await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn("长度限制", failure.exception.detail)
        self.assertIn("reason=truncated", captured.output[0])
        self.assertNotIn(TEXT, "".join(captured.output))
        self.create.return_value = FakeStream(json.dumps(RESULT))
        self.assertEqual((await grammar.analyze_grammar(TEXT)).sentence, TEXT)
        self.assertEqual(self.create.await_count, 2)

    async def test_alignment_failure_logs_fixed_reason_without_source_or_credentials(self):
        reply = dict(RESULT, segments=RESULT["segments"][:-1])
        self.create.return_value = FakeStream(json.dumps(reply))
        with self.assertLogs(grammar.logger, level="WARNING") as captured:
            with self.assertRaises(HTTPException) as failure:
                await grammar.analyze_grammar(TEXT)
        self.assertIn("对应原句", failure.exception.detail)
        logs = "".join(captured.output)
        self.assertIn("reason=segment_alignment", logs)
        for private_value in (TEXT, settings.DEEPSEEK_API_KEY, settings.DEEPSEEK_BASE_URL):
            self.assertNotIn(private_value, logs)

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
