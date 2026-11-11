"""Authenticated AI learning tools."""

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.services.grammar import GrammarAnalysis, analyze_grammar

router = APIRouter()


class GrammarRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    translation: str = Field(default="", max_length=2000)

    @field_validator("text")
    @classmethod
    def require_sentence(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("请选择有台词的字幕后再解析")
        return value  # Preserve original whitespace for exact highlighting.


@router.post("/grammar", response_model=GrammarAnalysis)
async def api_analyze_grammar(payload: GrammarRequest):
    return await analyze_grammar(payload.text, payload.translation)
