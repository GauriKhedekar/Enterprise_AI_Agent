"""Employee-side endpoints.

POST /employee/runs starts the 9-stage agent pipeline as a background task and returns
immediately: the full pipeline needs more wall-clock time than the ingress allows for a
single request. Each stage is persisted as it completes, so GET /employee/runs/{id}
streams real progress to the UI by polling.
"""
import asyncio
import logging
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from lib.db import db
from lib.dates import today_iso
from lib.mcp_tools import default_requires_approval
from lib.pipeline import WEEKLY_WFH_CAP, _week_bounds, _wfh_days_used_this_week, run_pipeline
from lib.security import CurrentUser, require_employee
from models.schemas import ActionRequestPublic, Employee, McpToolPublic, Policy, Run, RunCreate, WfhUsage, new_id, utcnow
from routers.company import _aware, _as_date, service_months

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/employee", tags=["employee"])


async def _my_employee(user: CurrentUser) -> Optional[dict]:
    if not user.employee_code:
        return None
    return await db.employees.find_one(
        {"company_id": user.company_id, "employee_code": user.employee_code}, {"_id": 0}
    )


@router.get("/profile", response_model=Employee | None)
async def my_profile(user: CurrentUser = Depends(require_employee)) -> Employee | None:
    doc = await _my_employee(user)
    if not doc:
        return None
    joining = _as_date(doc["joining_date"])
    return Employee(
        id=doc["id"],
        company_id=doc["company_id"],
        employee_code=doc["employee_code"],
        name=doc["name"],
        email=doc.get("email"),
        department=doc["department"],
        joining_date=joining,
        service_months=service_months(joining),
        employment_status=doc.get("employment_status", "active"),
        has_login=True,
    )


@router.get("/policies", response_model=list[Policy])
async def visible_policies(user: CurrentUser = Depends(require_employee)) -> list[Policy]:
    docs = await db.policies.find({"company_id": user.company_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    return [Policy(**{**d, "created_at": _aware(d["created_at"])}) for d in docs]


@router.get("/wfh-usage", response_model=WfhUsage)
async def wfh_usage(user: CurrentUser = Depends(require_employee)) -> WfhUsage:
    """This employee's approved+pending WFH days for the current calendar week, and how many
    of the weekly cap remain — powers the meter on the ask screen."""
    today = date.fromisoformat(today_iso())
    used = await _wfh_days_used_this_week(user.company_id, user.employee_code or "", today)
    monday, sunday = _week_bounds(today)
    return WfhUsage(
        week_start=monday.isoformat(),
        week_end=sunday.isoformat(),
        cap=WEEKLY_WFH_CAP,
        used_days=used,
        remaining=max(WEEKLY_WFH_CAP - len(used), 0),
    )


@router.get("/mcp-tools", response_model=list[McpToolPublic])
async def visible_mcp_tools(user: CurrentUser = Depends(require_employee)) -> list[McpToolPublic]:
    docs = await db.mcp_tools.find(
        {"company_id": user.company_id, "enabled_for_employees": True}, {"_id": 0}
    ).to_list(500)
    docs.sort(key=lambda d: (d["kind"], d["name"]))
    return [
        McpToolPublic(
            **{
                **d,
                "requires_human_approval": default_requires_approval(
                    d.get("kind", "read"), d.get("requires_human_approval")
                ),
                "created_at": _aware(d["created_at"]),
            }
        )
        for d in docs
    ]


async def _execute(run_id: str, query: str, company_id: str, user_id: str, code: Optional[str]) -> None:
    """Background pipeline execution; every stage lands in Mongo as it finishes."""

    async def emit(stage: dict[str, Any]) -> None:
        await db.runs.update_one({"id": run_id}, {"$push": {"trace": stage}})

    try:
        outcome = await run_pipeline(
            query=query,
            company_id=company_id,
            user_id=user_id,
            requester_code=code,
            run_id=run_id,
            emit=emit,
        )
        outcome.pop("trace", None)  # already streamed in via emit
        await db.runs.update_one({"id": run_id}, {"$set": {**outcome, "status": "complete"}})
    except Exception as exc:
        logger.exception("pipeline crashed for run %s", run_id)
        await db.runs.update_one(
            {"id": run_id},
            {
                "$set": {
                    "status": "error",
                    "decision": "INSUFFICIENT_INFO",
                    "answer": "The compliance pipeline failed unexpectedly. Please try again.",
                    "reasoning": f"Unhandled pipeline error: {exc}",
                }
            },
        )


@router.post("/runs", response_model=Run, status_code=201)
async def submit_run(payload: RunCreate, user: CurrentUser = Depends(require_employee)) -> Run:
    emp = await _my_employee(user)
    doc: dict[str, Any] = {
        "id": new_id(),
        "company_id": user.company_id,
        "user_id": user.id,
        "employee_code": user.employee_code,
        "employee_name": (emp or {}).get("name"),
        "query": payload.query.strip(),
        "status": "running",
        "decision": None,
        "reasoning": "",
        "answer": "",
        "cited_evidence": [],
        "tool_called": None,
        "action_taken": False,
        "policy_required": None,
        "enterprise_data_required": None,
        "action_required": None,
        "blocked": False,
        "trace": [],
        "latency_ms": None,
        "created_at": utcnow(),
    }
    await db.runs.insert_one(dict(doc))
    asyncio.create_task(
        _execute(doc["id"], doc["query"], user.company_id, user.id, user.employee_code)
    )
    return Run(**doc)


@router.get("/runs", response_model=list[Run])
async def my_runs(user: CurrentUser = Depends(require_employee)) -> list[Run]:
    docs = await db.runs.find(
        {"company_id": user.company_id, "user_id": user.id}, {"_id": 0}
    ).to_list(200)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    return [Run(**{**d, "created_at": _aware(d["created_at"])}) for d in docs]


@router.get("/action-requests", response_model=list[ActionRequestPublic])
async def my_action_requests(user: CurrentUser = Depends(require_employee)) -> list[ActionRequestPublic]:
    docs = await db.action_requests.find(
        {"company_id": user.company_id, "employee_code": user.employee_code}, {"_id": 0}
    ).to_list(200)
    docs.sort(key=lambda d: _aware(d["requested_at"]), reverse=True)
    return [
        ActionRequestPublic(
            **{
                **d,
                "requested_at": _aware(d["requested_at"]),
                "resolved_at": _aware(d.get("resolved_at")),
            }
        )
        for d in docs
    ]


@router.get("/runs/{run_id}", response_model=Run)
async def one_run(run_id: str, user: CurrentUser = Depends(require_employee)) -> Run:
    doc = await db.runs.find_one(
        {"id": run_id, "company_id": user.company_id, "user_id": user.id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    return Run(**{**doc, "created_at": _aware(doc["created_at"])})
