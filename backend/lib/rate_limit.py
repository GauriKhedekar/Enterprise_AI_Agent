"""Small in-memory rate limiter for low-scale state-changing endpoints."""
import time
from collections import defaultdict, deque
from typing import Deque

from fastapi import HTTPException, Request

_hits: dict[str, Deque[float]] = defaultdict(deque)


def rate_limit_key(request: Request, scope: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = (forwarded.split(",")[0] or "").strip()
    if not ip and request.client:
        ip = request.client.host
    return f"{scope}:{ip or 'unknown'}"


async def check_rate_limit(request: Request, scope: str, *, limit: int, window_seconds: int) -> None:
    now = time.monotonic()
    key = rate_limit_key(request, scope)
    bucket = _hits[key]
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
    bucket.append(now)
