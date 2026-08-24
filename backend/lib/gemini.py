"""Gemini REST client. The API key is the tenant's own, decrypted per call and never logged.

Free-tier Gemini quota is enforced *per model per day*, so a single model runs dry fast for
a 6-call pipeline. `MODELS` is an ordered fallback chain: a model that reports a per-day
quota violation is marked exhausted for this process and the next one is tried.
"""
import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

BASE = "https://generativelanguage.googleapis.com/v1beta"
MODELS = [
    m.strip()
    for m in os.environ.get(
        "GEMINI_MODELS",
        "gemini-3-flash-preview,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.6-flash",
    ).split(",")
    if m.strip()
]
EMBED_MODEL = os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-001")
TIMEOUT = httpx.Timeout(90.0, connect=10.0)

_exhausted: set[str] = set()


class GeminiError(RuntimeError):
    pass


def _redact(message: str, api_key: str) -> str:
    """Never let a key reach the logs or an error body."""
    if api_key:
        message = message.replace(api_key, "***")
    return message[:400]


def _is_daily_quota(body_text: str) -> bool:
    return "PerDay" in body_text or "RequestsPerDay" in body_text


def _retry_delay(body_text: str, attempt: int) -> float:
    match = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', body_text)
    if match:
        return min(float(match.group(1)) + 1.0, 30.0)
    return min(2.0 * (2 ** attempt), 24.0)


def available_models() -> list[str]:
    return [m for m in MODELS if m not in _exhausted] or list(MODELS)


async def _call_model(
    model: str, api_key: str, payload: dict[str, Any], attempts: int
) -> tuple[Optional[dict[str, Any]], str, bool]:
    """Returns (parsed | None, last_error, model_is_exhausted)."""
    url = f"{BASE}/models/{model}:generateContent"
    last = "no attempt made"

    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                res = await client.post(url, json=payload, headers={"x-goog-api-key": api_key})
        except httpx.HTTPError as exc:
            last = _redact(f"transport error: {exc}", api_key)
            if attempt + 1 < attempts:
                await asyncio.sleep(_retry_delay("", attempt))
                continue
            return None, last, False

        if res.status_code == 200:
            try:
                body = res.json()
                text = body["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text)
            except (KeyError, IndexError, ValueError) as exc:
                return None, _redact(f"unparseable body: {exc}", api_key), False
            if not isinstance(parsed, dict):
                return None, "non-object JSON payload", False
            return parsed, "", False

        last = _redact(f"HTTP {res.status_code}: {res.text}", api_key)

        # a model retired for this key, or out of daily quota: move on immediately
        if res.status_code == 404 or (res.status_code == 429 and _is_daily_quota(res.text)):
            return None, last, True

        if res.status_code in (429, 500, 502, 503, 504) and attempt + 1 < attempts:
            delay = _retry_delay(res.text, attempt)
            logger.warning("Gemini %s on %s — retrying in %.1fs", res.status_code, model, delay)
            await asyncio.sleep(delay)
            continue

        return None, last, False

    return None, last, False


async def generate_json(
    api_key: str,
    system: str,
    prompt: str,
    schema: dict[str, Any],
    temperature: float = 0.0,
    attempts: int = 3,
) -> dict[str, Any]:
    """One structured-JSON Gemini call, with retry and cross-model fallback."""
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": temperature,
        },
    }

    errors: list[str] = []
    for model in available_models():
        parsed, err, exhausted = await _call_model(model, api_key, payload, attempts)
        if parsed is not None:
            return parsed
        if exhausted:
            logger.warning("Gemini model %s exhausted/unavailable — falling back", model)
            _exhausted.add(model)
        errors.append(f"{model}: {err}")

    raise GeminiError("Gemini " + " | ".join(errors))


async def embed(api_key: str, texts: list[str]) -> list[list[float]]:
    """Batch embeddings for vector search. Returns one vector per input text."""
    if not texts:
        return []
    requests = [
        {"model": f"models/{EMBED_MODEL}", "content": {"parts": [{"text": t[:8000]}]}}
        for t in texts
    ]
    url = f"{BASE}/models/{EMBED_MODEL}:batchEmbedContents"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                res = await client.post(
                    url, json={"requests": requests}, headers={"x-goog-api-key": api_key}
                )
        except httpx.HTTPError as exc:
            if attempt < 2:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            raise GeminiError(_redact(f"Gemini embed transport error: {exc}", api_key)) from exc

        if res.status_code == 200:
            try:
                return [e["values"] for e in res.json()["embeddings"]]
            except (KeyError, TypeError) as exc:
                raise GeminiError("Gemini embed returned an unexpected body") from exc

        if res.status_code in (429, 503) and not _is_daily_quota(res.text) and attempt < 2:
            await asyncio.sleep(_retry_delay(res.text, attempt))
            continue
        raise GeminiError(_redact(f"Gemini embed HTTP {res.status_code}: {res.text}", api_key))

    raise GeminiError("Gemini embed exhausted retries")
