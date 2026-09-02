"""HR approval endpoints. Company admins are intentionally a superset of HR."""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from lib.db import db
from lib.mailer import action_resolved_email_html, send_email
from lib.mcp_tools import execute_action_tool, validate_tool_args
from lib.rate_limit import check_rate_limit
from lib.security import CurrentUser, require_hr_or_admin
from models.schemas import ActionRequestPublic, ActionRequestResolution, utcnow
from routers.company import _aware

router = APIRouter(prefix="/hr", tags=["hr"])


async def _notify_employee_resolution(
    company_id: str, doc: dict[str, Any], status: str, note: Optional[str]
) -> None:
    """Email the requesting employee that their action request was approved/rejected.
    Degrades to log-only when no RESEND_API_KEY is configured (see lib/mailer)."""
    emp = await db.employees.find_one(
        {"company_id": company_id, "employee_code": doc.get("employee_code")}, {"_id": 0}
    )
    email = (emp or {}).get("email")
    if not email:
        return
    company = await db.companies.find_one({"id": company_id}, {"_id": 0})
    tool = await db.mcp_tools.find_one(
        {"company_id": company_id, "name": doc.get("tool_name")}, {"_id": 0}
    )
    display = (tool or {}).get("display_name") or doc.get("tool_name", "action")
    request_date = (doc.get("tool_call_args") or {}).get("date")
    await send_email(
        email,
        f"Your {display} request was {status}",
        action_resolved_email_html(
            (company or {}).get("name", "your company"), display, status, note, request_date
        ),
    )


def _action_request(doc: dict[str, Any]) -> ActionRequestPublic:
    return ActionRequestPublic(
        **{
            **doc,
            "requested_at": _aware(doc["requested_at"]),
            "resolved_at": _aware(doc.get("resolved_at")),
        }
    )


@router.get("/action-requests", response_model=list[ActionRequestPublic])
async def list_action_requests(
    status: Optional[str] = "pending",
    user: CurrentUser = Depends(require_hr_or_admin),
) -> list[ActionRequestPublic]:
    query: dict[str, Any] = {"company_id": user.company_id}
    if status and status != "all":
        if status not in {"pending", "approved", "rejected"}:
            raise HTTPException(status_code=422, detail="Invalid action request status")
        query["status"] = status
    docs = await db.action_requests.find(query, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: _aware(d["requested_at"]), reverse=True)
    return [_action_request(d) for d in docs]


@router.post("/action-requests/{request_id}/approve", response_model=ActionRequestPublic)
async def approve_action_request(
    request_id: str,
    payload: ActionRequestResolution,
    request: Request,
    user: CurrentUser = Depends(require_hr_or_admin),
) -> ActionRequestPublic:
    await check_rate_limit(request, "hr-approve", limit=30, window_seconds=60)
    doc = await db.action_requests.find_one(
        {"id": request_id, "company_id": user.company_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Action request not found")
    if doc["status"] != "pending":
        raise HTTPException(status_code=409, detail="Action request is already resolved")

    tool = await db.mcp_tools.find_one(
        {"company_id": user.company_id, "name": doc["tool_name"], "kind": "action"},
        {"_id": 0},
    )
    if not tool:
        raise HTTPException(status_code=404, detail="Action tool no longer exists")
    validate_tool_args(tool.get("input_schema") or {}, doc.get("tool_call_args") or {})
    executed = await execute_action_tool(
        company_id=user.company_id,
        tool=tool,
        args=doc.get("tool_call_args") or {},
        actor=user.email,
    )
    resolved_at = utcnow()
    updates = {
        "status": "approved",
        "resolved_at": resolved_at,
        "resolved_by": user.email,
        "resolution_note": payload.resolution_note,
        "executed_result": executed,
    }
    await db.action_requests.update_one(
        {"id": request_id, "company_id": user.company_id, "status": "pending"},
        {"$set": updates},
    )
    await db.runs.update_one(
        {"id": doc["run_id"], "company_id": user.company_id},
        {
            "$push": {
                "trace": {
                    "name": "hr_approval",
                    "status": "approved",
                    "summary": f"HR approved and executed {doc['tool_name']}.",
                    "output": {
                        "action_request_id": request_id,
                        "resolved_by": user.email,
                        "executed_result": executed,
                    },
                    "latency_ms": 0,
                }
            }
        },
    )
    await _notify_employee_resolution(user.company_id, doc, "approved", payload.resolution_note)
    return _action_request({**doc, **updates})


@router.post("/action-requests/{request_id}/reject", response_model=ActionRequestPublic)
async def reject_action_request(
    request_id: str,
    payload: ActionRequestResolution,
    request: Request,
    user: CurrentUser = Depends(require_hr_or_admin),
) -> ActionRequestPublic:
    if request is not None:
        await check_rate_limit(request, "hr-reject", limit=30, window_seconds=60)
    doc = await db.action_requests.find_one(
        {"id": request_id, "company_id": user.company_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Action request not found")
    if doc["status"] != "pending":
        raise HTTPException(status_code=409, detail="Action request is already resolved")

    resolved_at = utcnow()
    updates = {
        "status": "rejected",
        "resolved_at": resolved_at,
        "resolved_by": user.email,
        "resolution_note": payload.resolution_note,
        "executed_result": None,
    }
    await db.action_requests.update_one(
        {"id": request_id, "company_id": user.company_id, "status": "pending"},
        {"$set": updates},
    )
    await db.runs.update_one(
        {"id": doc["run_id"], "company_id": user.company_id},
        {
            "$push": {
                "trace": {
                    "name": "hr_approval",
                    "status": "rejected",
                    "summary": f"HR rejected {doc['tool_name']}.",
                    "output": {
                        "action_request_id": request_id,
                        "resolved_by": user.email,
                        "resolution_note": payload.resolution_note,
                    },
                    "latency_ms": 0,
                }
            }
        },
    )
    await _notify_employee_resolution(user.company_id, doc, "rejected", payload.resolution_note)
    return _action_request({**doc, **updates})
