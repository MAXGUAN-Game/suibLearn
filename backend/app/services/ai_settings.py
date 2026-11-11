"""Persistent AI configuration, with credentials kept on the server."""

import asyncio
import logging
from dataclasses import dataclass, field

from fastapi import HTTPException
from openai import AsyncOpenAI, APITimeoutError, AuthenticationError, RateLimitError

from app.config import settings
from app.models.database import get_ai_settings, save_ai_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AIConfiguration:
    api_key: str = field(repr=False)
    base_url: str
    model: str
    version: int = 0

    def public(self) -> dict:
        return {
            "provider": "deepseek",
            "base_url": self.base_url,
            "model": self.model,
            "api_key_configured": bool(self.api_key),
            "version": self.version,
        }


async def get_ai_configuration() -> AIConfiguration:
    saved = await get_ai_settings()
    if saved:
        return AIConfiguration(**saved)
    return AIConfiguration(
        api_key=settings.DEEPSEEK_API_KEY.strip(),
        base_url=settings.DEEPSEEK_BASE_URL,
        model=settings.DEEPSEEK_MODEL,
    )


async def resolve_ai_configuration(api_key: str | None, base_url: str, model: str) -> AIConfiguration:
    current = await get_ai_configuration()
    return AIConfiguration(
        api_key=(api_key or "").strip() or current.api_key,
        base_url=base_url,
        model=model,
        version=current.version,
    )


async def update_ai_configuration(api_key: str | None, base_url: str, model: str) -> dict:
    effective = await resolve_ai_configuration(api_key, base_url, model)
    await save_ai_settings(effective.api_key, effective.base_url, effective.model)
    return (await get_ai_configuration()).public()


async def test_ai_configuration(config: AIConfiguration) -> dict:
    if not config.api_key:
        raise HTTPException(status_code=503, detail="请先填写 DeepSeek API 密钥。")

    async def probe():
        async with AsyncOpenAI(
            api_key=config.api_key, base_url=config.base_url, timeout=12.0, max_retries=0,
        ) as client:
            stream = await client.chat.completions.create(
                model=config.model,
                messages=[{"role": "user", "content": "Reply with only OK."}],
                stream=True,
                max_tokens=16,
                extra_body={"thinking": {"type": "disabled"}},
            )
            parts = []
            async with stream:
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        parts.append(chunk.choices[0].delta.content)
            if not "".join(parts).strip():
                raise ValueError("Empty provider response")

    try:
        await asyncio.wait_for(probe(), timeout=15.0)
    except (APITimeoutError, asyncio.TimeoutError):
        raise HTTPException(status_code=504, detail="连接测试超时，请检查服务地址或稍后重试。") from None
    except AuthenticationError:
        raise HTTPException(status_code=503, detail="API 密钥验证失败，请检查密钥是否正确。") from None
    except RateLimitError:
        raise HTTPException(status_code=503, detail="AI 服务繁忙或额度不足，请稍后重试。") from None
    except Exception as error:
        logger.warning("AI connection test failed (%s)", type(error).__name__)
        raise HTTPException(status_code=502, detail="连接测试失败，请检查服务地址、模型和账户状态。") from None
    return {"ok": True, "message": "DeepSeek 连接成功，可以开始解析台词。"}
