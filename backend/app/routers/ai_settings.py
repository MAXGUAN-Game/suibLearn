"""AI configuration endpoints. Responses never contain the stored API key."""

from urllib.parse import urlsplit

from fastapi import APIRouter
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, field_validator

from app.services.ai_settings import (
    get_ai_configuration,
    resolve_ai_configuration,
    test_ai_configuration,
    update_ai_configuration,
)

class SettingsRoute(APIRoute):
    """Pydantic's default validation errors echo input, which can contain secrets."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                return JSONResponse(status_code=422, content={"detail": [
                    {key: item[key] for key in ("loc", "msg", "type")}
                    for item in error.errors()
                ]})

        return handle


router = APIRouter(route_class=SettingsRoute)


class AISettingsRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=512)
    base_url: str = Field(min_length=1, max_length=2000)
    model: str = Field(min_length=1, max_length=100)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        try:
            parsed = urlsplit(value)
            # Access port to also reject invalid/non-numeric ports.
            parsed.port
            if (
                parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or "?" in value or "#" in value
                or any(character.isspace() for character in value)
                or "\\" in value
            ):
                raise ValueError
        except ValueError:
            raise ValueError("请输入有效的 HTTP/HTTPS API 地址，不包含账号、密码或查询参数") from None
        return value

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("模型名称不能为空")
        return value


@router.get("/ai")
async def api_get_ai_settings():
    return (await get_ai_configuration()).public()


@router.put("/ai")
async def api_update_ai_settings(payload: AISettingsRequest):
    return await update_ai_configuration(payload.api_key, payload.base_url, payload.model)


@router.post("/ai/test")
async def api_test_ai_settings(payload: AISettingsRequest):
    configuration = await resolve_ai_configuration(payload.api_key, payload.base_url, payload.model)
    return await test_ai_configuration(configuration)
