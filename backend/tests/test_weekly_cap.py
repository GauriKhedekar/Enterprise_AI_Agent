"""Part 1a — weekly WFH cap enforcement.

The cap must hold *across* requests: two days already booked in a calendar week means a
third is refused even though, read in isolation, the third request looks fine. These tests
cover the pure ledger arithmetic and a full mocked-LLM pipeline run proving the tool gate
overrides an ALLOW to DENY when the week is already full.
"""
import os
from datetime import date

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import lib.pipeline as pipeline
from lib.pipeline import _week_bounds, _wfh_cap_exceeded, _wfh_days_used_this_week

COMPANY = "co-cap-test"
REQUESTER = "EMP-0001"


def test_week_bounds_monday_to_sunday():
    monday, sunday = _week_bounds(date(2025, 6, 11))  # a Wednesday
    assert monday == date(2025, 6, 9)
    assert sunday == date(2025, 6, 15)


def test_cap_arithmetic():
    # two distinct days already booked, a third day exceeds the cap of 2
    assert _wfh_cap_exceeded(["2025-06-09", "2025-06-10"], "2025-06-11") is True
    # one booked, a second is still within the cap
    assert _wfh_cap_exceeded(["2025-06-09"], "2025-06-11") is False
    # re-requesting an already-booked day does not double-count
    assert _wfh_cap_exceeded(["2025-06-09", "2025-06-10"], "2025-06-10") is False


def _client():
    return AsyncIOMotorClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))


async def _seed(db, existing_dates, status="approved"):
    await db.employees.delete_many({"company_id": COMPANY})
    await db.mcp_tools.delete_many({"company_id": COMPANY})
    await db.action_requests.delete_many({"company_id": COMPANY})
    await db.policies.delete_many({"company_id": COMPANY})
    await db.employees.insert_one(
        {
            "id": "cap-e1", "company_id": COMPANY, "employee_code": REQUESTER,
            "name": "Cap Tester", "email": "cap.tester@acmerobotics.com",
            "department": "Engineering", "joining_date": "2023-01-01",
            "service_months": 30, "employment_status": "active", "employment_type": "full_time",
        }
    )
    await db.mcp_tools.insert_many(
        [
            {
                "id": "cap-read", "company_id": COMPANY, "name": "get_employee_details",
                "display_name": "Get Employee Details", "description": "read", "kind": "read",
                "server_url": "local://hr-mcp", "input_schema": {"type": "object"},
                "enabled_for_employees": True, "requires_human_approval": False,
                "created_by": "admin", "created_at": pipeline.utcnow(),
            },
            {
                "id": "cap-action", "company_id": COMPANY, "name": "submit_wfh_request",
                "display_name": "Submit WFH Request", "description": "action", "kind": "action",
                "server_url": "local://hr-mcp",
                "input_schema": {
                    "type": "object",
                    "properties": {"employee_id": {"type": "string"}, "date": {"type": "string", "format": "date"}},
                    "required": ["employee_id", "date"],
                },
                "enabled_for_employees": True, "requires_human_approval": True,
                "created_by": "admin", "created_at": pipeline.utcnow(),
            },
        ]
    )
    for d in existing_dates:
        await db.action_requests.insert_one(
            {
                "id": f"ar-{d}", "company_id": COMPANY, "employee_id": "cap-e1",
                "employee_code": REQUESTER, "employee_name": "Cap Tester",
                "tool_name": "submit_wfh_request", "tool_call_args": {"employee_id": REQUESTER, "date": d},
                "run_id": "run-old", "status": status, "requested_at": pipeline.utcnow(),
                "resolved_at": None, "resolved_by": None, "resolution_note": None, "executed_result": None,
            }
        )


async def _cleanup(db):
    await db.employees.delete_many({"company_id": COMPANY})
    await db.mcp_tools.delete_many({"company_id": COMPANY})
    await db.action_requests.delete_many({"company_id": COMPANY})
    await db.policies.delete_many({"company_id": COMPANY})


def _fake_gemini(referenced_code):
    async def fake_generate_json(api_key, system, prompt, schema):
        props = schema.get("properties", {})
        if "allowed" in props:
            return {"allowed": True, "category": "safe", "reason": "ok"}
        if "policy_required" in props:
            # skip policy retrieval (no network), require the HR record and treat as an action
            return {"policy_required": False, "enterprise_data_required": True,
                    "action_required": True, "rationale": "wfh request"}
        if "evidence_summary" in props:
            return {"evidence_summary": "summary", "key_facts": []}
        if "decision" in props:
            return {"decision": "ALLOW", "reasoning": "Requester meets the policy in isolation.",
                    "answer": "Approved.", "cited_evidence": [], "referenced_employee_code": referenced_code}
        if "grounded" in props:
            return {"grounded": True, "leaks_other_employee_data": False,
                    "unsupported_claims": [], "final_answer": "Approved."}
        return {}
    return fake_generate_json


@pytest.mark.asyncio
async def test_ledger_counts_approved_and_pending_and_excludes_current_run(monkeypatch):
    client = _client()
    db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(pipeline, "db", db)
    try:
        await _seed(db, ["2025-06-09", "2025-06-10"], status="pending")
        used = await _wfh_days_used_this_week(COMPANY, REQUESTER, date(2025, 6, 11), exclude_run_id="run-current")
        assert used == ["2025-06-09", "2025-06-10"]
        # a booking in a different week is not counted
        used_next = await _wfh_days_used_this_week(COMPANY, REQUESTER, date(2025, 6, 18))
        assert used_next == []
        # excluding the run that owns the ledger rows drops them
        used_excluded = await _wfh_days_used_this_week(COMPANY, REQUESTER, date(2025, 6, 11), exclude_run_id="run-old")
        assert used_excluded == []
    finally:
        await _cleanup(db)
        client.close()


@pytest.mark.asyncio
async def test_second_request_over_cap_is_denied_by_tool_gate(monkeypatch):
    client = _client()
    db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(pipeline, "db", db)
    monkeypatch.setattr(pipeline.gemini, "generate_json", _fake_gemini(REQUESTER))

    async def fake_key(_cid):
        return "fake-key"

    monkeypatch.setattr(pipeline, "_company_gemini_key", fake_key)
    try:
        # two days already booked this week -> a third exceeds the cap
        await _seed(db, ["2025-06-09", "2025-06-10"], status="approved")
        before = await db.action_requests.count_documents({"company_id": COMPANY})
        outcome = await pipeline.run_pipeline(
            query="Can I work from home on 2025-06-11?",
            company_id=COMPANY, user_id="u1", requester_code=REQUESTER, run_id="run-current",
        )
        assert outcome["decision"] == "DENY", outcome["decision"]
        assert outcome["action_taken"] is False
        assert "weekly" in outcome["answer"].lower()
        gate = next(s for s in outcome["trace"] if s["name"] == "tool_gate")
        assert gate["output"]["weekly_cap_exceeded"] is True
        # nothing new was written to the ledger
        after = await db.action_requests.count_documents({"company_id": COMPANY})
        assert after == before
    finally:
        await _cleanup(db)
        client.close()


@pytest.mark.asyncio
async def test_first_request_within_cap_is_submitted_for_approval(monkeypatch):
    client = _client()
    db = client[os.environ.get("DB_NAME", "app")]
    monkeypatch.setattr(pipeline, "db", db)
    monkeypatch.setattr(pipeline.gemini, "generate_json", _fake_gemini(REQUESTER))

    async def fake_key(_cid):
        return "fake-key"

    monkeypatch.setattr(pipeline, "_company_gemini_key", fake_key)
    try:
        # only one day booked -> a second is still within the cap of 2
        await _seed(db, ["2025-06-09"], status="approved")
        outcome = await pipeline.run_pipeline(
            query="Can I work from home on 2025-06-11?",
            company_id=COMPANY, user_id="u1", requester_code=REQUESTER, run_id="run-current",
        )
        assert outcome["decision"] == "ALLOW", outcome["decision"]
        assert outcome["tool_called"] == "submit_wfh_request"
        pending = await db.action_requests.find(
            {"company_id": COMPANY, "status": "pending", "run_id": "run-current"}, {"_id": 0}
        ).to_list(10)
        assert len(pending) == 1
        assert pending[0]["tool_call_args"]["date"] == "2025-06-11"
    finally:
        await _cleanup(db)
        client.close()
