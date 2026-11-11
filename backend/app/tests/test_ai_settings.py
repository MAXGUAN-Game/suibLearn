"""AI settings endpoint and dynamic-configuration regressions."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.auth import create_token
from app.config import settings
from app.main import app
from app.models import database
from app.services import ai_settings, grammar


class ProbeStream:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def __aiter__(self):
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="OK"))])


class AISettingsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(database, "_db_path", str(Path(self.temp.name) / "settings.db"))
        self.db_patch.start()
        self.env_patch = patch.object(settings, "DEEPSEEK_API_KEY", "env-key-private")
        self.env_patch.start()
        await database.init_db()
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.headers = {"Authorization": "Bearer " + create_token(settings.AUTH_PASSWORD)}
        self.payload = {
            "api_key": "saved-key-private",
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-flash",
        }
        self.create = AsyncMock(return_value=ProbeStream())
        self.sdk = AsyncMock()
        self.sdk.__aenter__.return_value = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=self.create)))
        self.sdk_patch = patch.object(ai_settings, "AsyncOpenAI", return_value=self.sdk)
        self.constructor = self.sdk_patch.start()

    async def asyncTearDown(self):
        await self.http.aclose()
        for task in list(grammar._inflight.values()):
            task.cancel()
        if grammar._inflight:
            await asyncio.gather(*grammar._inflight.values(), return_exceptions=True)
        grammar._inflight.clear()
        self.sdk_patch.stop()
        self.env_patch.stop()
        self.db_patch.stop()
        self.temp.cleanup()

    async def get(self):
        return await self.http.get("/api/settings/ai", headers=self.headers)

    async def put(self, payload=None):
        return await self.http.put("/api/settings/ai", json=self.payload if payload is None else payload, headers=self.headers)

    async def test_get_uses_environment_without_returning_key(self):
        response = await self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["provider"], "deepseek")
        self.assertTrue(response.json()["api_key_configured"])
        self.assertEqual(response.json()["version"], 0)
        self.assertNotIn("env-key-private", response.text)
        self.assertNotIn("api_key", response.json())

    async def test_save_is_persistent_and_empty_or_omitted_key_preserves_secret(self):
        response = await self.put()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["version"], 1)
        self.assertNotIn("saved-key-private", response.text)
        for key in ("", None):
            payload = dict(self.payload, model="another-model")
            if key is None:
                payload.pop("api_key")
            else:
                payload["api_key"] = key
            self.assertEqual((await self.put(payload)).status_code, 200)
            self.assertEqual((await ai_settings.get_ai_configuration()).api_key, "saved-key-private")
        # Reinitializing startup schema and reading a fresh SQLite connection retains values.
        await database.init_db()
        with patch.object(settings, "DEEPSEEK_API_KEY", "different-env-key"):
            config = await ai_settings.get_ai_configuration()
        self.assertEqual(config.api_key, "saved-key-private")
        self.assertEqual(config.model, "another-model")
        self.assertEqual(config.version, 3)

    async def test_first_save_with_empty_key_uses_environment_key(self):
        response = await self.put(dict(self.payload, api_key=""))
        self.assertEqual(response.status_code, 200)
        self.assertEqual((await ai_settings.get_ai_configuration()).api_key, "env-key-private")

    async def test_test_uses_unsaved_form_without_persisting(self):
        await self.put()
        unsaved = dict(self.payload, api_key="test-key-private", model="test-model", base_url="https://example.test/v1")
        response = await self.http.post("/api/settings/ai/test", json=unsaved, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(self.constructor.call_args.kwargs["api_key"], "test-key-private")
        self.assertEqual(self.create.call_args.kwargs["model"], "test-model")
        self.assertNotIn("response_format", self.create.call_args.kwargs)
        self.assertEqual(await database.get_ai_settings(), {
            "api_key": "saved-key-private", "base_url": self.payload["base_url"], "model": self.payload["model"], "version": 1,
        })
        self.assertNotIn("test-key-private", response.text)

    async def test_test_with_blank_key_uses_saved_key(self):
        await self.put()
        response = await self.http.post("/api/settings/ai/test", json=dict(self.payload, api_key=""), headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.constructor.call_args.kwargs["api_key"], "saved-key-private")

    async def test_connection_failure_is_redacted_and_does_not_save(self):
        self.create.side_effect = RuntimeError("secret-api-key upstream-private-details")
        response = await self.http.post("/api/settings/ai/test", json=self.payload, headers=self.headers)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("secret-api-key", response.text)
        self.assertNotIn("upstream-private-details", response.text)
        self.assertIsNone(await database.get_ai_settings())

    async def test_probe_requires_a_key_and_handles_timeout(self):
        with patch.object(settings, "DEEPSEEK_API_KEY", ""):
            response = await self.http.post("/api/settings/ai/test", json=dict(self.payload, api_key=""), headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.create.side_effect = ai_settings.APITimeoutError(request=httpx.Request("POST", "https://example.test"))
        response = await self.http.post("/api/settings/ai/test", json=self.payload, headers=self.headers)
        self.assertEqual(response.status_code, 504)

    async def test_all_routes_require_authentication(self):
        for method, path in (("GET", "/api/settings/ai"), ("PUT", "/api/settings/ai"), ("POST", "/api/settings/ai/test")):
            response = await self.http.request(method, path, json=self.payload)
            self.assertIn(response.status_code, (401, 403))
        self.assertIsNone(await database.get_ai_settings())

    async def test_invalid_fields_return_422_without_echoing_sensitive_input(self):
        for base_url in (
            "ftp://example.test", "/relative", "https://private-user:private-pass@example.test",
            "https://example.test?key=private-key", "https://example.test#fragment", "https://example.test:abc",
        ):
            response = await self.put(dict(self.payload, base_url=base_url))
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("private-pass", response.text)
            self.assertNotIn("private-key", response.text)
        for payload in (
            dict(self.payload, model="  "), dict(self.payload, model="m" * 101),
            dict(self.payload, api_key="private-key-" * 100),
        ):
            response = await self.put(payload)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("private-key-", response.text)

    async def test_configuration_is_normalized(self):
        response = await self.put(dict(self.payload, base_url=" https://api.deepseek.com/v1/ ", model=" deepseek-flash "))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["base_url"], "https://api.deepseek.com/v1")
        self.assertEqual(response.json()["model"], "deepseek-flash")

    async def test_grammar_uses_new_snapshot_without_changing_inflight_request(self):
        await self.put()
        gate = asyncio.Event()
        started = asyncio.Event()
        seen = []
        result = json.dumps({
            "sentence": "ね", "translation": "对吧", "summary": "句末语气词。",
            "segments": [{"text": "ね", "role": "语气词", "explanation": "寻求认同。"}],
        })

        async def collect(_client, _text, _translation, config):
            seen.append(config)
            if len(seen) == 1:
                started.set()
                await gate.wait()
            return result

        manager = AsyncMock()
        with patch.object(grammar, "AsyncOpenAI", return_value=manager), patch.object(grammar, "_collect_reply", side_effect=collect):
            old_request = asyncio.create_task(grammar.analyze_grammar("ね"))
            await asyncio.wait_for(started.wait(), timeout=2)
            await self.put(dict(self.payload, model="new-model", api_key="new-private-key"))
            await grammar.analyze_grammar("ね")
            gate.set()
            await old_request
        self.assertEqual([config.model for config in seen], ["deepseek-flash", "new-model"])
        self.assertEqual([config.api_key for config in seen], ["saved-key-private", "new-private-key"])
        self.assertEqual([config.version for config in seen], [1, 2])


if __name__ == "__main__":
    unittest.main()
