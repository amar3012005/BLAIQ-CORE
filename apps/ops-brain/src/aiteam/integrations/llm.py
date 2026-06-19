"""Minimal LLM client for the Admin Copilot (Track AA).

Dependency-light: talks to an OpenAI-compatible chat-completions endpoint via
httpx (already a dependency) rather than pulling in another SDK. On prod the
only LLM credential is the OpenRouter key (stored as OPENAI_API_KEY), so the
default base URL + model are OpenRouter's. Everything is overridable by env.
"""

from __future__ import annotations

import os
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_DEFAULT_BASE = "https://openrouter.ai/api/v1"
_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6"


def _api_key() -> str:
    return (
        os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    ).strip()


def copilot_model() -> str:
    return os.environ.get("BLAIQ_COPILOT_MODEL") or _DEFAULT_MODEL


async def chat(
    messages: list[dict[str, str]],
    *,
    model: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.3,
) -> dict[str, Any]:
    """Run a chat completion. Returns {"ok", "text", "model", "error"}.

    Never raises — callers branch on ``ok`` so a missing key or upstream error
    surfaces as a clean message instead of a 500.
    """
    key = _api_key()
    mdl = model or copilot_model()
    if not key:
        return {"ok": False, "text": None, "model": mdl, "error": "No LLM credential configured (set OPENAI_API_KEY / OPENROUTER_API_KEY)"}
    base = (os.environ.get("OPENROUTER_BASE_URL") or _DEFAULT_BASE).rstrip("/")
    payload = {
        "model": mdl,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # OpenRouter attribution headers (optional, harmless elsewhere).
        "HTTP-Referer": "https://blaiq.ai",
        "X-Title": "BLAIQ Admin Copilot",
    }
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{base}/chat/completions", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("copilot LLM transport error: %s", exc)
        return {"ok": False, "text": None, "model": mdl, "error": f"LLM unreachable: {exc}"}
    if resp.status_code >= 400:
        logger.warning("copilot LLM HTTP %s: %s", resp.status_code, resp.text[:200])
        reason = ""
        try:
            err = resp.json().get("error")
            if isinstance(err, dict):
                reason = str(err.get("message") or "")[:160]
        except ValueError:
            pass
        detail = f"LLM error {resp.status_code}" + (f": {reason}" if reason else "")
        return {"ok": False, "text": None, "model": mdl, "error": detail}
    try:
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as exc:
        return {"ok": False, "text": None, "model": mdl, "error": f"LLM bad response: {exc}"}
    return {"ok": True, "text": text, "model": mdl, "error": None}
