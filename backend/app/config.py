"""Application configuration - loads from environment variables / .env file."""

import os
import hashlib
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from project root
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)


class Settings:
    """Application settings loaded from environment."""

    # --- LLM API (OpenAI-compatible) ---
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "qwen3-omni-flash")

    # --- Sentence grammar analysis (separate from subtitle translation) ---
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")

    # --- Database ---
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parent.parent / "data" / "sublearn.db"))

    # --- Media Storage ---
    MEDIA_DIR: str = os.getenv("MEDIA_DIR", str(Path(__file__).resolve().parent.parent / "data" / "media"))
    MAX_FILE_SIZE: int = int(os.getenv("MAX_FILE_SIZE", "0"))  # 0 = no limit
    MAX_TOTAL_STORAGE: int = int(os.getenv("MAX_TOTAL_STORAGE", str(30 * 1024 * 1024 * 1024)))  # 30GB default

    # --- Authentication ---
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "sublearn123")
    JWT_SECRET: str = os.getenv(
        "JWT_SECRET",
        hashlib.sha256((os.getenv("AUTH_PASSWORD", "sublearn123") + "_sublearn_salt_k9x").encode()).hexdigest(),
    )
    JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "720"))  # 30 days

    # --- Server ---
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    def __init__(self):
        # Ensure directories exist
        os.makedirs(os.path.dirname(self.DATABASE_PATH), exist_ok=True)
        os.makedirs(self.MEDIA_DIR, exist_ok=True)


settings = Settings()
