"""Run with: python -m unittest discover -s app/tests -p test_grammar.py"""

import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from pydantic import ValidationError

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
        {"text": "何か ", "structure": "宾语 / 不定修饰语", "role": "不定代词", "meaning": "什么；某件事",
         "explanation": "指不确定的事情，修饰后面的宾语。",
         "reading_tokens": [{"text": "何", "reading": "なに"}, {"text": "か ", "reading": ""}]},
        {"text": "悪いこと", "structure": "宾语", "role": "名词短语", "meaning": "坏事",
         "explanation": "形容词悪い修饰こと，口语中省略宾格助词を。",
         "reading_tokens": [{"text": "悪", "reading": "わる"}, {"text": "いこと", "reading": ""}]},
        {"text": "した", "structure": "谓语", "role": "动词过去式", "meaning": "做了",
         "explanation": "する的た形，表示已发生的动作。",
         "reading_tokens": [{"text": "した", "reading": ""}]},
        {"text": "の？", "structure": "语气成分", "role": "解释性疑问", "meaning": "",
         "explanation": "句末の带有要求对方说明原因或情况的语气。",
         "reading_tokens": [{"text": "の？", "reading": ""}]},
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
        "segments": [{
            "text": piece, "structure": "谓语", "role": "语法成分", "meaning": "该片段的中文意思",
            "explanation": "该成分在本句的语法作用。",
            "reading_tokens": [{"text": piece, "reading": ""}],
        } for piece in pieces],
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
        self.assertEqual(self.create.call_args.kwargs["max_tokens"], 8192)
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

    async def test_real_japanese_exclamation_has_structure_meaning_and_kanji_ruby(self):
        text = "器用なもんだな"
        reply = {
            "sentence": text, "translation": "真是灵巧啊。",
            "summary": "省略主语的感叹句，ものだ缩约为もんだ，终助词な表示赞叹。",
            "segments": [
                {"text": "器用な", "structure": "定语", "role": "形容动词连体形",
                 "meaning": "灵巧的；熟练的", "explanation": "器用だ通过な连接后面的形式名词。",
                 "reading_tokens": [{"text": "器用", "reading": "きよう"}, {"text": "な", "reading": ""}]},
                {"text": "もん", "structure": "谓语中心语", "role": "形式名词的口语缩约",
                 "meaning": "人或事物（泛指）", "explanation": "もの的口语形式，在这里是名词性谓语的中心语。",
                 "reading_tokens": [{"text": "もん", "reading": ""}]},
                {"text": "だ", "structure": "判断谓语", "role": "断定助动词", "meaning": "",
                 "explanation": "接在名词性成分之后构成判断。", "reading_tokens": [{"text": "だ", "reading": ""}]},
                {"text": "な", "structure": "语气成分", "role": "终助词", "meaning": "",
                 "explanation": "句末な表达说话人的赞叹。", "reading_tokens": [{"text": "な", "reading": ""}]},
            ],
        }
        self.create.return_value = FakeStream(json.dumps(reply))
        result = await grammar.analyze_grammar(text)
        self.assertEqual(result.model_dump(), reply)
        self.assertEqual([s.structure for s in result.segments], ["定语", "谓语中心语", "判断谓语", "语气成分"])
        self.assertEqual(result.segments[0].meaning, "灵巧的；熟练的")
        self.assertEqual(result.segments[0].reading_tokens[0].reading, "きよう")
        self.assertEqual((await grammar.analyze_grammar(text)).model_dump(), reply)
        self.create.assert_awaited_once()

    async def test_prompt_exclamation_example_is_valid_and_has_no_invented_object(self):
        example = grammar.SYSTEM_PROMPT.split("完整示例：\n", 1)[1]
        result = grammar._validate_analysis(example, "器用なもんだな")
        self.assertEqual([s.text for s in result.segments], ["器用な", "もん", "だ", "な"])
        self.assertEqual([s.structure for s in result.segments], ["定语", "谓语中心语", "判断谓语", "语气成分"])
        self.assertIn("时间状语 / 连体修饰从句 / 谓语", grammar.SYSTEM_PROMPT)

    async def test_english_relative_clause_keeps_structure_separate_from_word_class(self):
        text = "The book that she recommended is useful."
        reply = analysis_for(text, ["The book", "that she recommended", "is", "useful", "."])
        structures = ["主语", "主语 / 定语从句", "谓语 / 系动词", "谓语 / 表语", "标点"]
        roles = ["名词短语", "限制性定语从句", "系动词", "形容词", "标点"]
        meanings = ["这本书", "她推荐的", "是", "有用的", ""]
        for segment, structure, role, meaning in zip(reply["segments"], structures, roles, meanings):
            segment.update(structure=structure, role=role, meaning=meaning)
        self.create.return_value = FakeStream(json.dumps(reply))
        result = await grammar.analyze_grammar(text)
        self.assertEqual([s.structure for s in result.segments], structures)
        self.assertEqual([s.role for s in result.segments], roles)
        self.assertEqual([s.meaning for s in result.segments], meanings)
        self.assertEqual("".join(t.text for s in result.segments for t in s.reading_tokens), text)
        self.assertTrue(all(t.reading == "" for s in result.segments for t in s.reading_tokens))

    async def test_reading_token_boundaries_restore_whitespace_at_both_levels(self):
        text = " \tI've  wanted\nto tell her off. \t"
        reply = analysis_for(text, ["I've", "wanted", "to tell her off."])
        reply["segments"][-1]["reading_tokens"] = [
            {"text": "to", "reading": ""}, {"text": "tell", "reading": ""},
            {"text": "her", "reading": ""}, {"text": "off.", "reading": ""},
        ]
        self.create.return_value = FakeStream(json.dumps(reply))
        result = await grammar.analyze_grammar(text)
        self.assertEqual([t.text for t in result.segments[-1].reading_tokens], [
            "\nto", " tell", " her", " off. \t",
        ])
        for segment in result.segments:
            self.assertEqual("".join(t.text for t in segment.reading_tokens), segment.text)
        self.assertEqual("".join(s.text for s in result.segments), text)
        self.assertEqual((await grammar.analyze_grammar(text)).model_dump(), result.model_dump())
        self.create.assert_awaited_once()

    async def test_existing_reading_token_whitespace_is_not_duplicated(self):
        text = "She  had had enough."
        reply = analysis_for(text, [text])
        tokens = ["She ", " had", " had ", "enough."]
        reply["segments"][0]["reading_tokens"] = [{"text": t, "reading": ""} for t in tokens]
        result = grammar._validate_analysis(json.dumps(reply), text)
        self.assertEqual([t.text for t in result.segments[0].reading_tokens], tokens)

    async def test_reading_tokens_cannot_rewrite_skip_or_reorder_original_characters(self):
        for pieces in (
            ["悪", "こと"], ["悪", "いとこ"], ["いこと", "悪"], ["悪い事"],
        ):
            with self.subTest(pieces=pieces):
                reply = json.loads(json.dumps(RESULT))
                reply["segments"][1]["reading_tokens"] = [
                    {"text": p, "reading": "わる" if "悪" in p else ""} for p in pieces
                ]
                with self.assertRaises(grammar.AnalysisFormatError) as failure:
                    grammar._validate_analysis(json.dumps(reply), TEXT)
                self.assertEqual(failure.exception.reason, "reading_alignment")

    async def test_reading_tokens_cannot_repair_internal_whitespace(self):
        text = "to  tell her"
        reply = analysis_for(text, [text])
        reply["segments"][0]["reading_tokens"] = [{"text": "to tell her", "reading": ""}]
        with self.assertRaises(grammar.AnalysisFormatError) as failure:
            grammar._validate_analysis(json.dumps(reply), text)
        self.assertEqual(failure.exception.reason, "reading_alignment")

    async def test_kanji_requires_hiragana_reading_and_rejects_katakana_or_latin(self):
        for reading in ("", "ナニ", "nani", "何", "なニ", "な に", " なに ", "ー"):
            with self.subTest(reading=reading):
                reply = json.loads(json.dumps(RESULT))
                reply["segments"][0]["reading_tokens"][0]["reading"] = reading
                with self.assertRaises(grammar.AnalysisFormatError) as failure:
                    grammar._validate_analysis(json.dumps(reply), TEXT)
                self.assertEqual(failure.exception.reason, "invalid_reading")

    async def test_kana_english_whitespace_and_punctuation_do_not_get_ruby(self):
        for text, reading in (("もん", "もん"), ("カフェ", "かふぇ"), ("book", "ぶっく"), (" ", "くうはく"), ("？", "はてな")):
            with self.subTest(text=text):
                reply = analysis_for(text, [text])
                reply["segments"][0]["reading_tokens"][0]["reading"] = reading
                with self.assertRaises(grammar.AnalysisFormatError) as failure:
                    grammar._validate_analysis(json.dumps(reply), text)
                self.assertEqual(failure.exception.reason, "invalid_reading")

    async def test_ruby_accepts_irregular_kanji_reading_and_supplementary_ideographs(self):
        text = "今日、時々、𠮷田。"
        reply = analysis_for(text, [text])
        reply["segments"][0]["reading_tokens"] = [
            {"text": "今日", "reading": "きょう"}, {"text": "、", "reading": ""},
            {"text": "時々", "reading": "ときどき"}, {"text": "、", "reading": ""},
            {"text": "𠮷田", "reading": "よしだ"}, {"text": "。", "reading": ""},
        ]
        self.assertEqual(grammar._validate_analysis(json.dumps(reply), text).model_dump(), reply)

    async def test_new_fields_are_required_and_metadata_cannot_be_blank_or_untyped(self):
        for field in ("structure", "meaning", "reading_tokens"):
            with self.subTest(missing=field):
                reply = json.loads(json.dumps(RESULT))
                del reply["segments"][0][field]
                with self.assertRaises(ValidationError):
                    grammar._validate_analysis(json.dumps(reply), TEXT)
        for field, value in (("structure", "   "), ("structure", "subject"), ("meaning", "   "), ("meaning", "something")):
            with self.subTest(field=field, value=value):
                reply = json.loads(json.dumps(RESULT))
                reply["segments"][0][field] = value
                with self.assertRaises(grammar.AnalysisFormatError):
                    grammar._validate_analysis(json.dumps(reply), TEXT)
        for field, value in (("reading_tokens", []), ("reading_tokens", None), ("structure", 1), ("meaning", None)):
            with self.subTest(field=field, value=value):
                reply = json.loads(json.dumps(RESULT))
                reply["segments"][0][field] = value
                with self.assertRaises(ValidationError):
                    grammar._validate_analysis(json.dumps(reply), TEXT)

    async def test_harmless_extra_fields_are_ignored_at_every_level_and_not_cached(self):
        reply = json.loads(json.dumps(RESULT))
        reply["provider_metadata"] = {"private": "private-provider-data"}
        reply["segments"][0]["color"] = "red"
        reply["segments"][0]["reading_tokens"][0]["ruby_style"] = "small"
        self.create.return_value = FakeStream(json.dumps(reply))
        result = await grammar.analyze_grammar(TEXT)
        self.assertEqual(result.model_dump(), RESULT)
        self.assertNotIn("private-provider-data", result.model_dump_json())
        self.assertEqual((await grammar.analyze_grammar(TEXT)).model_dump(), RESULT)
        self.create.assert_awaited_once()

    async def test_extra_alias_does_not_replace_required_field(self):
        reply = json.loads(json.dumps(RESULT))
        reply["segments"][0]["syntax"] = reply["segments"][0].pop("structure")
        with self.assertRaises(ValidationError):
            grammar._validate_analysis(json.dumps(reply), TEXT)

    async def test_schema_failure_logs_only_fixed_categories_and_allows_retry(self):
        reply = json.loads(json.dumps(RESULT))
        reply["summary"] = "private-provider-summary" * 200
        del reply["segments"][0]["structure"]
        reply["segments"][0]["reading_tokens"][0]["reading"] = {"secret": "private-provider-reading"}
        self.create.return_value = FakeStream(json.dumps(reply))
        with self.assertLogs(grammar.logger, level="WARNING") as captured:
            with self.assertRaises(HTTPException) as failure:
                await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)
        logs = "".join(captured.output)
        self.assertIn("reason=invalid_schema; kinds=length,missing,type", logs)
        for private_value in (TEXT, "private-provider-summary", "private-provider-reading", "reading_tokens", settings.DEEPSEEK_API_KEY):
            self.assertNotIn(private_value, logs)
            self.assertNotIn(private_value, failure.exception.detail)
        self.create.return_value = FakeStream(json.dumps(RESULT))
        self.assertEqual((await grammar.analyze_grammar(TEXT)).model_dump(), RESULT)
        self.assertEqual(self.create.await_count, 2)

    async def test_schema_diagnostics_do_not_echo_unknown_error_codes(self):
        error = SimpleNamespace(errors=lambda **_: [
            {"type": "private-provider-code", "input": "private-input", "loc": ("private-location",)},
            {"type": "missing"},
        ])
        self.assertEqual(grammar._schema_error_kinds(error), "missing,other")

    async def test_invalid_ruby_is_not_cached_and_logs_do_not_disclose_provider_content(self):
        reply = json.loads(json.dumps(RESULT))
        reply["segments"][0]["reading_tokens"][0]["reading"] = "private-provider-content"
        self.create.return_value = FakeStream(json.dumps(reply))
        with self.assertLogs(grammar.logger, level="WARNING") as captured:
            with self.assertRaises(HTTPException) as failure:
                await grammar.analyze_grammar(TEXT)
        self.assertEqual(failure.exception.status_code, 502)
        self.assertIn("reason=invalid_reading", "".join(captured.output))
        self.assertNotIn("private-provider-content", "".join(captured.output))
        self.create.return_value = FakeStream(json.dumps(RESULT))
        self.assertEqual((await grammar.analyze_grammar(TEXT)).model_dump(), RESULT)
        self.assertEqual(self.create.await_count, 2)

    async def test_previous_prompt_version_cache_does_not_reuse_old_schema(self):
        config = await grammar.get_ai_configuration()
        for version in ("sentence-grammar-v2", "sentence-grammar-v3"):
            old_key = hashlib.sha256(json.dumps([
                version, config.base_url, config.model, config.version, TEXT, "",
            ], ensure_ascii=False).encode("utf-8")).hexdigest()
            old_reply = json.loads(json.dumps(RESULT))
            if version.endswith("v2"):
                for segment in old_reply["segments"]:
                    for field in ("structure", "meaning", "reading_tokens"):
                        del segment[field]
            else:
                old_reply["segments"][0]["structure"] = "旧结构标注"
            await database.save_grammar_analysis(old_key, json.dumps(old_reply))
        self.assertEqual(grammar.PROMPT_VERSION, "sentence-grammar-v4")
        self.assertEqual((await grammar.analyze_grammar(TEXT)).model_dump(), RESULT)
        self.create.assert_awaited_once()

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
