"""SQLite database module for tracking videos and subtitle processing."""

import aiosqlite
import json
import time
import uuid
from typing import Optional

from app.config import settings

_db_path = settings.DATABASE_PATH


async def get_db() -> aiosqlite.Connection:
    """Get a database connection."""
    db = await aiosqlite.connect(_db_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def init_db():
    """Initialize database tables."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # Collections table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cover_path TEXT,
                source_language TEXT DEFAULT 'ja',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Videos table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_language TEXT DEFAULT 'ja',
                video_filename TEXT NOT NULL,
                subtitle_filename TEXT NOT NULL,
                video_path TEXT NOT NULL,
                subtitle_path TEXT NOT NULL,
                duration REAL,
                file_size INTEGER,
                thumbnail_path TEXT,
                status TEXT DEFAULT 'processing',
                collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: add collection_id to existing videos table if missing
        cursor = await db.execute("PRAGMA table_info(videos)")
        columns = [row[1] for row in await cursor.fetchall()]
        if "collection_id" not in columns:
            await db.execute("ALTER TABLE videos ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL")

        # Subtitle lines table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS subtitle_lines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
                index_num INTEGER NOT NULL,
                start_time REAL NOT NULL,
                end_time REAL NOT NULL,
                original_text TEXT NOT NULL,
                translated_text TEXT,
                annotation TEXT,
                status TEXT DEFAULT 'pending',
                UNIQUE(video_id, index_num)
            )
        """)

        # Index for faster subtitle retrieval
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_subtitle_lines_video_id
            ON subtitle_lines(video_id, start_time)
        """)

        # Index for faster collection video lookups
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_videos_collection_id
            ON videos(collection_id)
        """)

        # Successful AI sentence analyses survive restarts without changing subtitles.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS grammar_analysis_cache (
                cache_key TEXT PRIMARY KEY,
                result_json TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                api_key TEXT NOT NULL,
                base_url TEXT NOT NULL,
                model TEXT NOT NULL,
                version INTEGER NOT NULL DEFAULT 1
            )
        """)

        # The application has one shared account, so preferences are a singleton.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS playback_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                speed REAL NOT NULL DEFAULT 1 CHECK (speed IN (0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3)),
                subtitle_mode TEXT NOT NULL DEFAULT 'bilingual'
                    CHECK (subtitle_mode IN ('original', 'bilingual', 'off')),
                sentence_mode INTEGER NOT NULL DEFAULT 0 CHECK (sentence_mode IN (0, 1)),
                updated_at INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS playback_progress (
                video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
                position REAL NOT NULL CHECK (position >= 0 AND position <= duration),
                duration REAL NOT NULL CHECK (duration > 0),
                updated_at INTEGER NOT NULL
            )
        """)

        await db.commit()


def _playback_preferences(row) -> dict:
    if row is None:
        return {"speed": 1.0, "subtitle_mode": "bilingual", "sentence_mode": False, "updated_at": 0}
    result = dict(row)
    result["sentence_mode"] = bool(result["sentence_mode"])
    return result


async def get_playback_settings() -> dict:
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT speed, subtitle_mode, sentence_mode, updated_at FROM playback_settings WHERE id = 1"
        )
        return _playback_preferences(await cursor.fetchone())


async def save_playback_settings(changes: dict) -> dict:
    # Only these known columns may enter the dynamic UPDATE. Updating only supplied
    # columns also prevents simultaneous partial saves from reverting one another.
    columns = [name for name in ("speed", "subtitle_mode", "sentence_mode") if name in changes]
    if not columns:
        return await get_playback_settings()
    defaults = {"speed": 1.0, "subtitle_mode": "bilingual", "sentence_mode": False}
    values = {**defaults, **{name: changes[name] for name in columns}}
    timestamp = time.time_ns() // 1_000_000
    updates = ", ".join(f"{name} = excluded.{name}" for name in columns)
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(f"""
            INSERT INTO playback_settings (id, speed, subtitle_mode, sentence_mode, updated_at)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET {updates},
                updated_at = MAX(excluded.updated_at, playback_settings.updated_at + 1)
        """, (values["speed"], values["subtitle_mode"], values["sentence_mode"], timestamp))
        cursor = await db.execute(
            "SELECT speed, subtitle_mode, sentence_mode, updated_at FROM playback_settings WHERE id = 1"
        )
        result = _playback_preferences(await cursor.fetchone())
        await db.commit()
        return result


async def get_playback_progress(video_id: str) -> Optional[dict]:
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("""
            SELECT v.id AS video_id, COALESCE(p.position, 0) AS position,
                COALESCE(p.duration, 0) AS duration, COALESCE(p.updated_at, 0) AS updated_at
            FROM videos v LEFT JOIN playback_progress p ON p.video_id = v.id
            WHERE v.id = ?
        """, (video_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def save_playback_progress(video_id: str, position: float, duration: float) -> Optional[dict]:
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        # Keep existence check and write in the same short transaction so deleting
        # a video concurrently cannot leave an orphan or produce a foreign-key 500.
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("SELECT id FROM videos WHERE id = ?", (video_id,))
        if await cursor.fetchone() is None:
            return None
        await db.execute("""
            INSERT INTO playback_progress (video_id, position, duration, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET position = excluded.position,
                duration = excluded.duration,
                updated_at = MAX(excluded.updated_at, playback_progress.updated_at + 1)
        """, (video_id, position, duration, time.time_ns() // 1_000_000))
        cursor = await db.execute(
            "SELECT video_id, position, duration, updated_at FROM playback_progress WHERE video_id = ?",
            (video_id,),
        )
        result = dict(await cursor.fetchone())
        await db.commit()
        return result


async def get_grammar_analysis(cache_key: str) -> Optional[str]:
    async with aiosqlite.connect(_db_path) as db:
        cursor = await db.execute(
            "SELECT result_json FROM grammar_analysis_cache WHERE cache_key = ?",
            (cache_key,),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def get_ai_settings() -> Optional[dict]:
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT api_key, base_url, model, version FROM ai_settings WHERE id = 1")
        row = await cursor.fetchone()
        return dict(row) if row else None


async def save_ai_settings(api_key: str, base_url: str, model: str):
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("""
            INSERT INTO ai_settings (id, api_key, base_url, model, version)
            VALUES (1, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key,
                base_url = excluded.base_url, model = excluded.model, version = ai_settings.version + 1
        """, (api_key, base_url, model))
        await db.commit()


async def save_grammar_analysis(cache_key: str, result_json: str):
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO grammar_analysis_cache (cache_key, result_json) VALUES (?, ?)",
            (cache_key, result_json),
        )
        # Bound storage for a long-running personal server.
        await db.execute("""
            DELETE FROM grammar_analysis_cache WHERE cache_key IN (
                SELECT cache_key FROM grammar_analysis_cache
                ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 2000
            )
        """)
        await db.commit()


# --- Video Operations ---

async def create_video(
    video_id: str,
    title: str,
    source_language: str,
    video_filename: str,
    subtitle_filename: str,
    video_path: str,
    subtitle_path: str,
    file_size: int = 0,
    collection_id: Optional[str] = None,
) -> dict:
    """Create a new video record."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO videos (id, title, source_language, video_filename, subtitle_filename,
                                video_path, subtitle_path, file_size, status, collection_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?)
            """,
            (video_id, title, source_language, video_filename, subtitle_filename,
             video_path, subtitle_path, file_size, collection_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM videos WHERE id = ?", (video_id,))
        row = await cursor.fetchone()
        return dict(row)


async def get_video(video_id: str) -> Optional[dict]:
    """Get a video by ID."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM videos WHERE id = ?", (video_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def list_videos(search: str = "", language: str = "", collection_id: Optional[str] = None) -> list[dict]:
    """List all videos with optional search, language, and collection filter."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM videos WHERE 1=1"
        params = []

        if search:
            query += " AND title LIKE ?"
            params.append(f"%{search}%")
        if language:
            query += " AND source_language = ?"
            params.append(language)
        if collection_id is not None:
            query += " AND collection_id = ?"
            params.append(collection_id)

        query += " ORDER BY created_at DESC"
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def update_video_status(video_id: str, status: str):
    """Update video processing status."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            "UPDATE videos SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (status, video_id),
        )
        await db.commit()


async def delete_video(video_id: str):
    """Delete a video and its subtitle lines (cascade)."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        await db.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        await db.commit()


async def update_videos_collection(
    video_ids: list[str],
    collection_id: Optional[str],
) -> int:
    """Batch update the collection_id for a list of videos. Returns number of rows matched."""
    if not video_ids:
        return 0
    async with aiosqlite.connect(_db_path) as db:
        placeholders = ",".join("?" * len(video_ids))
        cursor = await db.execute(
            f"UPDATE videos SET collection_id = ?, updated_at = CURRENT_TIMESTAMP "
            f"WHERE id IN ({placeholders})",
            [collection_id, *video_ids],
        )
        affected = cursor.rowcount
        await db.commit()
        return affected if affected is not None else 0


# --- Subtitle Line Operations ---

async def insert_subtitle_lines(video_id: str, lines: list[dict]):
    """Insert parsed subtitle lines for a video."""
    async with aiosqlite.connect(_db_path) as db:
        await db.executemany(
            """
            INSERT OR REPLACE INTO subtitle_lines
                (video_id, index_num, start_time, end_time, original_text, translated_text, status)
            VALUES (?, ?, ?, ?, ?, ?, 'done')
            """,
            [(video_id, line["index_num"], line["start_time"], line["end_time"],
              line["original_text"], line.get("translated_text", ""))
             for line in lines],
        )
        await db.commit()


async def get_subtitle_lines(video_id: str) -> list[dict]:
    """Get all subtitle lines for a video, ordered by start time."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM subtitle_lines WHERE video_id = ? ORDER BY start_time",
            (video_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def update_subtitle_translation(video_id: str, index_num: int, translated_text: str):
    """Update translation for a single subtitle line."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            """
            UPDATE subtitle_lines SET translated_text = ?, status = 'translated'
            WHERE video_id = ? AND index_num = ?
            """,
            (translated_text, video_id, index_num),
        )
        await db.commit()


async def update_subtitle_translations_batch(video_id: str, translations: list[dict]):
    """Batch update translations for multiple subtitle lines."""
    async with aiosqlite.connect(_db_path) as db:
        await db.executemany(
            """
            UPDATE subtitle_lines SET translated_text = ?, status = 'translated'
            WHERE video_id = ? AND index_num = ?
            """,
            [(t["translated_text"], video_id, t["index_num"]) for t in translations],
        )
        await db.commit()


async def update_subtitle_annotation(video_id: str, index_num: int, annotation: str):
    """Update annotation for a single subtitle line."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            """
            UPDATE subtitle_lines SET annotation = ?, status = 'done'
            WHERE video_id = ? AND index_num = ?
            """,
            (annotation, video_id, index_num),
        )
        await db.commit()


async def update_subtitle_annotations_batch(video_id: str, annotations: list[dict]):
    """Batch update annotations for multiple subtitle lines."""
    async with aiosqlite.connect(_db_path) as db:
        await db.executemany(
            """
            UPDATE subtitle_lines SET annotation = ?, status = 'done'
            WHERE video_id = ? AND index_num = ?
            """,
            [(a["annotation"], video_id, a["index_num"]) for a in annotations],
        )
        await db.commit()


async def check_all_subtitles_done(video_id: str) -> bool:
    """Check if all subtitle lines for a video are fully processed."""
    async with aiosqlite.connect(_db_path) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM subtitle_lines WHERE video_id = ? AND status != 'done'",
            (video_id,),
        )
        row = await cursor.fetchone()
        return row[0] == 0

# --- Settings Operations ---

async def get_setting(key: str) -> Optional[str]:
    """Get a setting value by key."""
    async with aiosqlite.connect(_db_path) as db:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row[0] if row else None


async def set_setting(key: str, value: str):
    """Set a setting value."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        await db.commit()


# --- Collection Operations ---

async def create_collection(
    name: str,
    source_language: str = "ja",
    cover_path: Optional[str] = None,
) -> dict:
    """Create a new collection."""
    collection_id = str(uuid.uuid4())
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO collections (id, name, source_language, cover_path)
            VALUES (?, ?, ?, ?)
            """,
            (collection_id, name, source_language, cover_path),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,))
        row = await cursor.fetchone()
        return dict(row)


async def list_collections() -> list[dict]:
    """List all collections with video counts."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT c.*, COUNT(v.id) AS video_count
            FROM collections c
            LEFT JOIN videos v ON v.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
            """
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_collection(collection_id: str) -> Optional[dict]:
    """Get a collection by ID (with video count)."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT c.*, COUNT(v.id) AS video_count
            FROM collections c
            LEFT JOIN videos v ON v.collection_id = c.id
            WHERE c.id = ?
            GROUP BY c.id
            """,
            (collection_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_collection(
    collection_id: str,
    name: Optional[str] = None,
    cover_path: Optional[str] = None,
) -> Optional[dict]:
    """Update a collection's name and/or cover. Returns updated record or None if not found."""
    async with aiosqlite.connect(_db_path) as db:
        db.row_factory = aiosqlite.Row

        # Build dynamic update
        fields = []
        params = []
        if name is not None:
            fields.append("name = ?")
            params.append(name)
        if cover_path is not None:
            fields.append("cover_path = ?")
            params.append(cover_path)

        if not fields:
            # Nothing to update, just return current
            cursor = await db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,))
            row = await cursor.fetchone()
            return dict(row) if row else None

        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.append(collection_id)

        await db.execute(
            f"UPDATE collections SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def delete_collection(collection_id: str) -> list[str]:
    """Delete a collection and return the IDs of videos that belonged to it (for file cleanup)."""
    async with aiosqlite.connect(_db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # Get video IDs for file cleanup
        cursor = await db.execute(
            "SELECT id FROM videos WHERE collection_id = ?", (collection_id,)
        )
        video_ids = [row[0] for row in await cursor.fetchall()]

        # Delete videos (cascade deletes subtitle_lines)
        await db.execute("DELETE FROM videos WHERE collection_id = ?", (collection_id,))

        # Delete collection
        await db.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
        await db.commit()

        return video_ids
