"""Two-step manager-then-HR approval routing."""
import os
from types import SimpleNamespace

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import lib.pipeline as pipeline
from routers.hr import _authorize, _queue_query

from tests.test_weekly_cap import _cleanup, _fake_gemini, _seed  # reuse fixtures

COMPANY = "co-cap-test"
REQUESTER = "EMP-0001"
MANAGER_CODE = "EMP-MGR"


def _client():
    return AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))


def test_queue_query_scopes_by_role():
    mgr = SimpleNamespace(role="manager", company_id="c1", employee_code="EMP-9")
    assert _queue_query(mgr) == {"company_id": "c1", "stage": "manager", "manager_employee_code": "EMP-9"}
    hr = SimpleNamespace(role="hr", company_id="c1", employee_code=None)
    assert _queue_query(hr) == {"company_id": "c1", "stage": "hr"}
    admin = SimpleNamespace(role="company_admin", company_id="c1", employee_code=None)
    assert _queue_query(admin) == {"company_id": "c1"}  # superset: every stage


def test_authorize_manager_scope():
    from fastapi import HTTPException

    mgr = SimpleNamespace(role="manager", employee_code="EMP-9")
    _authorize(mgr, {"stage": "manager", "manager_employee_code": "EMP-9"})  # own report: ok
    with pytest.raises(HTTPException):  # another manager's report
        _authorize(mgr, {"stage": "manager", "manager_employee_code": "EMP-8"})
    with pytest.raises(HTTPException):  # HR-stage request not for a manager
        _authorize(mgr, {"stage": "hr"})
    hr = SimpleNamespace(role="hr", employee_code=None)
    _authorize(hr, {"stage": "hr"})  # ok
    with pytest.raises(HTTPException):  # manager stage not for HR yet
        _authorize(hr, {"stage": "manager", "manager_employee_code": "EMP-9"})


@pytest.mark.asyncio
async def test_request_routes_to_manager_when_manager_exists(monkeypatch):
    client = _client()
    db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(pipeline, "db", db)
    monkeypatch.setattr(pipeline.gemini, "generate_json", _fake_gemini(REQUESTER))

    async def fake_key(_cid):
        return "fake-key"

    monkeypatch.setattr(pipeline, "_company_gemini_key", fake_key)
    try:
        await _seed(db, [], status="approved")  # no WFH days used → within cap
        # give the requester a manager and create that manager's login
        await db.employees.update_one(
            {"company_id": COMPANY, "employee_code": REQUESTER},
            {"$set": {"manager_employee_code": MANAGER_CODE}},
        )
        await db.users.insert_one(
            {"id": "mgr-user", "company_id": COMPANY, "email": "mgr@x.com", "role": "manager",
             "employee_code": MANAGER_CODE, "password_hash": "x", "invite_token": None}
        )
        outcome = await pipeline.run_pipeline(
            query="Can I work from home on 2025-06-11?",
            company_id=COMPANY, user_id="u1", requester_code=REQUESTER, run_id="run-mgr",
        )
        assert outcome["decision"] == "ALLOW"
        req = await db.action_requests.find_one({"company_id": COMPANY, "run_id": "run-mgr"}, {"_id": 0})
        assert req is not None
        assert req["stage"] == "manager"
        assert req["manager_employee_code"] == MANAGER_CODE
        assert req["status"] == "pending"
    finally:
        await db.users.delete_many({"company_id": COMPANY})
        await _cleanup(db)
        client.close()
