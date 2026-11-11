"""SubLearn - 视频字幕学习平台 后端主入口"""

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager

from app.config import settings
from app.models.database import init_db
from app.auth import get_current_user
from app.routers import auth as auth_router, upload, library, collections, analysis, ai_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager."""
    # Startup: initialize database
    await init_db()
    yield
    # Shutdown: cleanup if needed


app = FastAPI(
    title="SubLearn API",
    description="视频字幕学习平台后端服务 - 上传视频+字幕，生成学习模式",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS middleware - allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "*",  # Allow all for mobile access during dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
# Auth router — login endpoint is public, verify is self-protected
app.include_router(auth_router.router, prefix="/api/auth", tags=["auth"])
# Protected routers — require valid JWT on every endpoint
app.include_router(upload.router, prefix="/api/upload", tags=["upload"], dependencies=[Depends(get_current_user)])
app.include_router(library.router, prefix="/api/videos", tags=["library"], dependencies=[Depends(get_current_user)])
app.include_router(collections.router, prefix="/api/collections", tags=["collections"], dependencies=[Depends(get_current_user)])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"], dependencies=[Depends(get_current_user)])
app.include_router(ai_settings.router, prefix="/api/settings", tags=["settings"], dependencies=[Depends(get_current_user)])

# Serve media files (for local dev; in production Nginx handles this)
app.mount("/media", StaticFiles(directory=settings.MEDIA_DIR), name="media")


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "sublearn", "version": "0.2.0"}
