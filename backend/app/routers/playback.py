"""Persistent shared-account player preferences and per-video resume positions."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import database


class PlaybackRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                # Non-finite JSON inputs must yield 422, rather than making the
                # default error response fail when it tries to encode NaN/Infinity.
                return JSONResponse(status_code=422, content={"detail": [
                    {key: item[key] for key in ("loc", "msg", "type")}
                    for item in error.errors()
                ]})

        return handle


router = APIRouter(route_class=PlaybackRoute)


class PlaybackSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    speed: float = Field(default=1.0, allow_inf_nan=False)
    subtitle_mode: Literal["original", "bilingual", "off"] = "bilingual"
    sentence_mode: bool = False

    @field_validator("speed")
    @classmethod
    def supported_speed(cls, value: float) -> float:
        if value not in (0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3):
            raise ValueError("不支持的播放倍速")
        return value


class PlaybackProgressUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    position: float = Field(ge=0, allow_inf_nan=False)
    duration: float = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def position_within_duration(self):
        if self.position > self.duration:
            raise ValueError("观看进度不能超过视频时长")
        return self


@router.get("/settings")
async def get_settings():
    return await database.get_playback_settings()


@router.put("/settings")
async def update_settings(payload: PlaybackSettingsUpdate):
    return await database.save_playback_settings(payload.model_dump(exclude_unset=True))


@router.get("/progress/{video_id}")
async def get_progress(video_id: str):
    result = await database.get_playback_progress(video_id)
    if result is None:
        raise HTTPException(status_code=404, detail="视频不存在")
    return result


@router.put("/progress/{video_id}")
async def update_progress(video_id: str, payload: PlaybackProgressUpdate):
    result = await database.save_playback_progress(video_id, payload.position, payload.duration)
    if result is None:
        raise HTTPException(status_code=404, detail="视频不存在")
    return result
