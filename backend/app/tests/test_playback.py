"""Player preferences and resume-position persistence regressions."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import aiosqlite
import httpx

from app.auth import create_token
from app.config import settings
from app.main import app
from app.models import database


class PlaybackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "playback.db")
        self.db_patch = patch.object(database, "_db_path", self.path)
        self.db_patch.start()
        await database.init_db()
        for video_id in ("episode-1", "episode-2"):
            await database.create_video(video_id, video_id, "ja", "v.mp4", "s.srt", "/v", "/s")
        self.http = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
        self.headers = {"Authorization": "Bearer " + create_token(settings.AUTH_PASSWORD)}

    async def asyncTearDown(self):
        await self.http.aclose()
        self.db_patch.stop()
        self.temp.cleanup()

    async def request(self, method, path, payload=None):
        return await self.http.request(method, "/api/playback" + path, headers=self.headers, json=payload)

    async def test_defaults_and_unknown_video(self):
        response = await self.request("GET", "/settings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "speed": 1, "subtitle_mode": "bilingual", "sentence_mode": False, "updated_at": 0,
        })
        response = await self.request("GET", "/progress/episode-1")
        self.assertEqual(response.json(), {"video_id": "episode-1", "position": 0, "duration": 0, "updated_at": 0})
        self.assertEqual((await self.request("GET", "/progress/missing")).status_code, 404)
        self.assertEqual((await self.request("PUT", "/progress/missing", {"position": 3, "duration": 10})).status_code, 404)

    async def test_settings_partial_updates_persist_across_restart_and_client(self):
        first = await self.request("PUT", "/settings", {"speed": 1.5, "subtitle_mode": "original"})
        self.assertEqual(first.status_code, 200)
        second = await self.request("PUT", "/settings", {"sentence_mode": True})
        self.assertEqual(second.json()["speed"], 1.5)
        self.assertEqual(second.json()["subtitle_mode"], "original")
        self.assertTrue(second.json()["sentence_mode"])
        self.assertGreater(second.json()["updated_at"], first.json()["updated_at"])
        await database.init_db()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://another-device") as other:
            response = await other.get("/api/playback/settings", headers=self.headers)
        self.assertEqual(response.json(), second.json())
        empty = await self.request("PUT", "/settings", {})
        self.assertEqual(empty.json(), second.json())

    async def test_simultaneous_partial_updates_preserve_both_fields(self):
        responses = await asyncio.gather(
            self.request("PUT", "/settings", {"speed": 2}),
            self.request("PUT", "/settings", {"subtitle_mode": "off"}),
            self.request("PUT", "/settings", {"sentence_mode": True}),
        )
        self.assertTrue(all(response.status_code == 200 for response in responses))
        result = (await self.request("GET", "/settings")).json()
        self.assertEqual((result["speed"], result["subtitle_mode"], result["sentence_mode"]), (2, "off", True))

    async def test_progress_persists_independently_and_supports_rewinding_and_completion(self):
        first = await self.request("PUT", "/progress/episode-1", {"position": 123.5, "duration": 1500})
        self.assertEqual(first.status_code, 200)
        self.assertGreater(first.json()["updated_at"], 0)
        await self.request("PUT", "/progress/episode-2", {"position": 8, "duration": 1200})
        await database.init_db()
        self.assertEqual((await self.request("GET", "/progress/episode-1")).json(), first.json())
        for position in (30, 0, 1500):
            response = await self.request("PUT", "/progress/episode-1", {"position": position, "duration": 1500})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["position"], position)
        self.assertGreater(response.json()["updated_at"], first.json()["updated_at"])
        self.assertEqual((await self.request("GET", "/progress/episode-2")).json()["position"], 8)

    async def test_deleting_video_cascades_progress(self):
        await self.request("PUT", "/progress/episode-1", {"position": 3, "duration": 10})
        await self.request("PUT", "/progress/episode-2", {"position": 8, "duration": 10})
        await database.delete_video("episode-1")
        self.assertEqual((await self.request("GET", "/progress/episode-1")).status_code, 404)
        async with aiosqlite.connect(self.path) as db:
            cursor = await db.execute("SELECT video_id FROM playback_progress ORDER BY video_id")
            self.assertEqual(await cursor.fetchall(), [("episode-2",)])

    async def test_deleting_collection_cascades_its_videos_progress(self):
        collection = await database.create_collection("Season 1")
        await database.update_videos_collection(["episode-1"], collection["id"])
        await self.request("PUT", "/progress/episode-1", {"position": 3, "duration": 10})
        await database.delete_collection(collection["id"])
        async with aiosqlite.connect(self.path) as db:
            cursor = await db.execute("SELECT COUNT(*) FROM playback_progress")
            self.assertEqual((await cursor.fetchone())[0], 0)

    async def test_every_route_requires_authentication(self):
        for method, path, payload in (
            ("GET", "/settings", None),
            ("PUT", "/settings", {"speed": 2}),
            ("GET", "/progress/episode-1", None),
            ("PUT", "/progress/episode-1", {"position": 1, "duration": 10}),
        ):
            response = await self.http.request(method, "/api/playback" + path, json=payload)
            self.assertIn(response.status_code, (401, 403))
        self.assertEqual((await database.get_playback_settings())["updated_at"], 0)
        self.assertEqual((await database.get_playback_progress("episode-1"))["updated_at"], 0)

    async def test_invalid_settings_cannot_overwrite_saved_preferences(self):
        await self.request("PUT", "/settings", {"speed": 1.5, "sentence_mode": True})
        saved = await database.get_playback_settings()
        for payload in (
            {"speed": 0}, {"speed": -1}, {"speed": 1.1}, {"speed": "2"}, {"speed": True},
            {"speed": None}, {"subtitle_mode": "Japanese"}, {"subtitle_mode": None},
            {"sentence_mode": "false"}, {"sentence_mode": 1}, {"sentence_mode": None}, {"unexpected": 1},
        ):
            with self.subTest(payload=payload):
                self.assertEqual((await self.request("PUT", "/settings", payload)).status_code, 422)
        self.assertEqual(await database.get_playback_settings(), saved)

    async def test_invalid_progress_does_not_replace_resume_position(self):
        await self.request("PUT", "/progress/episode-1", {"position": 3, "duration": 10})
        saved = await database.get_playback_progress("episode-1")
        for payload in (
            {"position": -1, "duration": 10}, {"position": 11, "duration": 10},
            {"position": 0, "duration": 0}, {"position": 0, "duration": -1},
            {"position": "3", "duration": 10}, {"position": True, "duration": 10},
            {"position": 3}, {"duration": 10}, {"position": None, "duration": 10},
        ):
            with self.subTest(payload=payload):
                self.assertEqual((await self.request("PUT", "/progress/episode-1", payload)).status_code, 422)
        self.assertEqual(await database.get_playback_progress("episode-1"), saved)

    async def test_nonfinite_numbers_return_422_instead_of_invalid_json_errors(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            for path, payload in (
                ("/settings", {"speed": value}),
                ("/progress/episode-1", {"position": value, "duration": 10}),
                ("/progress/episode-1", {"position": 3, "duration": value}),
            ):
                response = await self.http.put("/api/playback" + path, content=json.dumps(payload),
                                               headers={**self.headers, "Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422)

    async def test_playback_settings_do_not_modify_ai_configuration(self):
        await database.save_ai_settings("secret", "https://example.test", "model")
        before = await database.get_ai_settings()
        await self.request("PUT", "/settings", {"speed": 3, "subtitle_mode": "off", "sentence_mode": True})
        await self.request("PUT", "/progress/episode-1", {"position": 3, "duration": 10})
        self.assertEqual(await database.get_ai_settings(), before)


if __name__ == "__main__":
    unittest.main()
