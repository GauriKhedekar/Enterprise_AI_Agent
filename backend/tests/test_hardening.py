"""Part 2 — production-hardening verifications.

Each item in the hardening checklist gets a real, deterministic test rather than an
assumption. Config-validation and cookie tests call the actual functions with a production
environment; the rate-limit and exception-handler tests exercise the exact code paths the
endpoints use.
"""
import os
import uuid

import pytest
from fastapi import Response
from starlette.requests import Request

import server
from lib.rate_limit import check_rate_limit
from routers.auth import _set_session


# ---- item 1: weak secrets must PREVENT startup in production ----
def test_placeholder_jwt_secret_blocks_production_startup(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "dev-insecure-jwt-secret")
    monkeypatch.setenv("APP_MASTER_KEY", "a" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        server._validate_production_config()


def test_placeholder_master_key_blocks_production_startup(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "a" * 40)
    monkeypatch.setenv("APP_MASTER_KEY", "change-me-app-master-key")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    with pytest.raises(RuntimeError, match="APP_MASTER_KEY"):
        server._validate_production_config()


# ---- item 2: CORS cannot silently stay '*' in production ----
def test_wildcard_cors_blocks_production_startup(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "a" * 40)
    monkeypatch.setenv("APP_MASTER_KEY", "b" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        server._validate_production_config()


def test_strong_config_passes_and_forces_secure_cookie(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "a" * 40)
    monkeypatch.setenv("APP_MASTER_KEY", "b" * 40)
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com,https://www.example.com")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    server._validate_production_config()  # must not raise
    assert os.environ["COOKIE_SECURE"] == "true"  # item 3: forced on in production


# ---- item 3: cookie is Secure + SameSite=None on an HTTPS deployment ----
def test_session_cookie_is_secure_and_samesite_none_in_production(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    resp = Response()
    _set_session(resp, "u1", "c1", "employee")
    cookie = resp.headers.get("set-cookie", "")
    assert "Secure" in cookie
    assert "samesite=none" in cookie.lower()
    assert "httponly" in cookie.lower()


def test_session_cookie_is_lax_and_insecure_in_dev(monkeypatch):
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    resp = Response()
    _set_session(resp, "u1", "c1", "employee")
    cookie = resp.headers.get("set-cookie", "")
    assert "samesite=lax" in cookie.lower()
    assert "Secure" not in cookie


# ---- item 4: the global exception handler leaks nothing ----
@pytest.mark.asyncio
async def test_exception_handler_body_is_generic():
    scope = {"type": "http", "method": "GET", "path": "/api/x", "headers": [], "client": ("t", 1)}
    request = Request(scope)
    resp = await server.unhandled_exception_handler(
        request, ValueError("secret stack detail: password=hunter2")
    )
    assert resp.status_code == 500
    assert resp.body == b'{"detail":"Internal server error"}'
    assert b"hunter2" not in resp.body
    assert b"ValueError" not in resp.body


# ---- item 5: rate limiting actually fires ----
@pytest.mark.asyncio
async def test_rate_limiter_raises_429_after_limit():
    scope_name = f"unit-{uuid.uuid4()}"
    req = Request(
        {"type": "http", "method": "POST", "path": "/x",
         "headers": [(b"x-forwarded-for", b"203.0.113.5")], "client": ("t", 1)}
    )
    from fastapi import HTTPException

    for _ in range(5):
        await check_rate_limit(req, scope_name, limit=5, window_seconds=60)
    with pytest.raises(HTTPException) as exc:
        await check_rate_limit(req, scope_name, limit=5, window_seconds=60)
    assert exc.value.status_code == 429


def test_login_endpoint_returns_429_after_limit(client):
    # A test-only spoofed client IP keeps this bucket separate from real users.
    ip = f"198.51.100.{uuid.uuid4().int % 200 + 10}"
    headers = {"x-forwarded-for": ip}
    statuses = [
        client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong"}, headers=headers).status_code
        for _ in range(12)
    ]
    assert statuses[:10] == [401] * 10  # first 10 pass the limiter, fail on credentials
    assert 429 in statuses[10:]  # once the limit is exceeded, 429 fires


# ---- item 6: a crashing background pipeline resolves the run to 'error' ----
@pytest.mark.asyncio
async def test_background_pipeline_crash_marks_run_error(monkeypatch):
    import routers.employee as employee_router
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(employee_router, "db", db)

    async def boom(**_kwargs):
        raise RuntimeError("forced mid-pipeline crash")

    monkeypatch.setattr(employee_router, "run_pipeline", boom)

    run_id = f"run-crash-{uuid.uuid4()}"
    try:
        await db.runs.insert_one(
            {"id": run_id, "company_id": "co-crash", "user_id": "u1", "status": "running",
             "query": "test", "trace": []}
        )
        await employee_router._execute(run_id, "test", "co-crash", "u1", "EMP-0001")
        doc = await db.runs.find_one({"id": run_id}, {"_id": 0})
        assert doc["status"] == "error"
        assert doc["decision"] == "INSUFFICIENT_INFO"
    finally:
        await db.runs.delete_many({"id": run_id})
        client.close()
