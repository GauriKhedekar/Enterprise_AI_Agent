"""Company-admin endpoints. Every query is scoped by the authenticated user's company_id."""
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from lib.dates import today_iso
from lib.db import db
from lib.mailer import invite_email_html, send_email
from lib.mcp_tools import default_requires_approval
from lib.pipeline import compare_backends
from lib.security import CurrentUser, encrypt_secret, hash_password, last4, require_admin, require_hr_or_admin
from models.schemas import (
    ApiKeyCreate,
    ApiKeyPublic,
    ApiKeyRotate,
    CompareCase,
    CompareRequest,
    CompareResponse,
    CompareStats,
    DashboardStats,
    Employee,
    EmployeeCreate,
    EmployeeUpdate,
    InviteRequest,
    InviteResult,
    McpToolCreate,
    McpToolPublic,
    McpToolUpdate,
    Policy,
    PolicyCreate,
    PaginatedRuns,
    Run,
    new_id,
    utcnow,
)
from routers.auth import app_base_url, new_invite_token

router = APIRouter(prefix="/company", tags=["company"])


def _aware(value: Any) -> Any:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _as_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def service_months(joining: date) -> int:
    today = date.fromisoformat(today_iso())
    months = (today.year - joining.year) * 12 + (today.month - joining.month)
    if today.day < joining.day:
        months -= 1
    return max(months, 0)


def _employee(doc: dict[str, Any], login_emails: set[str]) -> Employee:
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
        employment_type=doc.get("employment_type", "full_time"),
        has_login=bool(doc.get("email")) and doc.get("email", "").lower() in login_emails,
    )


async def _next_employee_code(company_id: str) -> str:
    count = await db.employees.count_documents({"company_id": company_id})
    while True:
        code = f"EMP-{count + 1:04d}"
        if not await db.employees.find_one({"company_id": company_id, "employee_code": code}):
            return code
        count += 1


# ---------------- dashboard ----------------
@router.get("/dashboard", response_model=DashboardStats)
async def dashboard(user: CurrentUser = Depends(require_admin)) -> DashboardStats:
    cid = user.company_id
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    keys = await db.api_keys.find({"company_id": cid}, {"_id": 0, "provider": 1}).to_list(100)
    return DashboardStats(
        company_name=(company or {}).get("name", "—"),
        employee_count=await db.employees.count_documents({"company_id": cid}),
        policy_count=await db.policies.count_documents({"company_id": cid}),
        keys_configured=len(keys),
        providers_configured=sorted({k["provider"] for k in keys}),
        run_count=await db.runs.count_documents({"company_id": cid}),
        pending_invites=await db.users.count_documents(
            {"company_id": cid, "invite_token": {"$ne": None}}
        ),
        mcp_tools_enabled=await db.mcp_tools.count_documents(
            {"company_id": cid, "enabled_for_employees": True}
        ),
    )


@router.get("/runs", response_model=PaginatedRuns)
async def list_runs(
    page: int = 1,
    page_size: int = 10,
    decision: Optional[str] = None,
    user: CurrentUser = Depends(require_admin),
) -> PaginatedRuns:
    """Paginated agent-run log for this tenant, optionally filtered by decision outcome."""
    page = max(page, 1)
    page_size = min(max(page_size, 1), 50)
    query: dict[str, Any] = {"company_id": user.company_id}
    if decision and decision != "ALL":
        query["decision"] = decision

    total = await db.runs.count_documents(query)
    docs = await db.runs.find(query, {"_id": 0}).to_list(2000)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    start = (page - 1) * page_size
    window = docs[start : start + page_size]

    counts: dict[str, int] = {}
    for row in await db.runs.find({"company_id": user.company_id}, {"_id": 0, "decision": 1}).to_list(2000):
        key = row.get("decision") or "PENDING"
        counts[key] = counts.get(key, 0) + 1

    return PaginatedRuns(
        items=[Run(**{**d, "created_at": _aware(d["created_at"])}) for d in window],
        total=total,
        page=page,
        page_size=page_size,
        pages=max((total + page_size - 1) // page_size, 1),
        decision_counts=counts,
    )


@router.get("/compare/suggestions", response_model=list[str])
async def compare_suggestions(user: CurrentUser = Depends(require_admin)) -> list[str]:
    """Distinct past queries from this tenant's runs, newest first."""
    docs = await db.runs.find({"company_id": user.company_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    seen: list[str] = []
    for d in docs:
        q = (d.get("query") or "").strip()
        if q and q not in seen:
            seen.append(q)
    return seen[:20]


@router.post("/compare", response_model=CompareResponse)
async def compare_backends_endpoint(
    payload: CompareRequest, user: CurrentUser = Depends(require_admin)
) -> CompareResponse:
    """Run each query through both retrieval backends over the same policy documents."""
    queries = [q.strip() for q in payload.queries if q and q.strip()][:5]
    if not queries:
        raise HTTPException(status_code=422, detail="Provide at least one query")

    # reuse the original asker's employee_code when the query came from a past run
    codes: dict[str, Optional[str]] = {}
    for doc in await db.runs.find({"company_id": user.company_id}, {"_id": 0}).to_list(500):
        q = (doc.get("query") or "").strip()
        if q and q not in codes:
            codes[q] = doc.get("employee_code")

    cases: list[dict[str, Any]] = []
    for q in queries:
        cases.append(
            await compare_backends(
                query=q, company_id=user.company_id, employee_code=codes.get(q)
            )
        )

    compared = [c for c in cases if c["qdrant"]["decision"] and c["pageindex"]["decision"]]
    agreements = sum(1 for c in compared if c["decisions_agree"])

    def avg(key: str) -> int:
        vals = [c[key]["latency_ms"] for c in cases if c[key]["latency_ms"]]
        return int(sum(vals) / len(vals)) if vals else 0

    overlaps = [c["evidence_overlap"] for c in cases]
    stats = {
        "total": len(cases),
        "compared": len(compared),
        "agreements": agreements,
        "agreement_rate": round(agreements / len(compared), 3) if compared else 0.0,
        "avg_latency_qdrant_ms": avg("qdrant"),
        "avg_latency_pageindex_ms": avg("pageindex"),
        "avg_evidence_overlap": round(sum(overlaps) / len(overlaps), 3) if overlaps else 0.0,
    }
    return CompareResponse(cases=[CompareCase(**c) for c in cases], stats=CompareStats(**stats))


# ---------------- api keys ----------------
@router.get("/api-keys", response_model=list[ApiKeyPublic])
async def list_api_keys(user: CurrentUser = Depends(require_admin)) -> list[ApiKeyPublic]:
    docs = await db.api_keys.find({"company_id": user.company_id}, {"_id": 0}).to_list(100)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    return [
        ApiKeyPublic(
            id=d["id"],
            provider=d["provider"],
            label=d["label"],
            last_four=d["last_four"],
            endpoint=d.get("endpoint"),
            created_by=d["created_by"],
            created_at=_aware(d["created_at"]),
            rotated_at=_aware(d.get("rotated_at")),
        )
        for d in docs
    ]


@router.post("/api-keys", response_model=ApiKeyPublic, status_code=201)
async def create_api_key(payload: ApiKeyCreate, user: CurrentUser = Depends(require_admin)) -> ApiKeyPublic:
    value = payload.value.strip()
    doc = {
        "id": new_id(),
        "company_id": user.company_id,
        "provider": payload.provider,
        "label": payload.label.strip(),
        "encrypted_value": encrypt_secret(value),
        "last_four": last4(value),
        "endpoint": (payload.endpoint or "").strip() or None,
        "created_by": user.email,
        "created_at": utcnow(),
        "rotated_at": None,
    }
    await db.api_keys.insert_one(dict(doc))
    return ApiKeyPublic(**{k: doc[k] for k in ("id", "provider", "label", "last_four", "endpoint", "created_by", "created_at", "rotated_at")})


@router.post("/api-keys/{key_id}/rotate", response_model=ApiKeyPublic)
async def rotate_api_key(
    key_id: str, payload: ApiKeyRotate, user: CurrentUser = Depends(require_admin)
) -> ApiKeyPublic:
    existing = await db.api_keys.find_one({"id": key_id, "company_id": user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="API key not found")
    value = payload.value.strip()
    rotated_at = utcnow()
    await db.api_keys.update_one(
        {"id": key_id, "company_id": user.company_id},
        {"$set": {"encrypted_value": encrypt_secret(value), "last_four": last4(value), "rotated_at": rotated_at}},
    )
    return ApiKeyPublic(
        id=existing["id"],
        provider=existing["provider"],
        label=existing["label"],
        last_four=last4(value),
        endpoint=existing.get("endpoint"),
        created_by=existing["created_by"],
        created_at=_aware(existing["created_at"]),
        rotated_at=rotated_at,
    )


@router.delete("/api-keys/{key_id}", status_code=204)
async def delete_api_key(key_id: str, user: CurrentUser = Depends(require_admin)) -> None:
    result = await db.api_keys.delete_one({"id": key_id, "company_id": user.company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="API key not found")


# ---------------- MCP tools ----------------
def _mcp_tool(doc: dict[str, Any]) -> McpToolPublic:
    return McpToolPublic(
        **{
            **doc,
            "requires_human_approval": default_requires_approval(
                doc.get("kind", "read"), doc.get("requires_human_approval")
            ),
            "created_at": _aware(doc["created_at"]),
        }
    )


@router.get("/mcp-tools", response_model=list[McpToolPublic])
async def list_mcp_tools(user: CurrentUser = Depends(require_admin)) -> list[McpToolPublic]:
    docs = await db.mcp_tools.find({"company_id": user.company_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda d: (d["kind"], d["name"]))
    return [_mcp_tool(d) for d in docs]


@router.post("/mcp-tools", response_model=McpToolPublic, status_code=201)
async def create_mcp_tool(
    payload: McpToolCreate, user: CurrentUser = Depends(require_admin)
) -> McpToolPublic:
    if await db.mcp_tools.find_one({"company_id": user.company_id, "name": payload.name}):
        raise HTTPException(status_code=409, detail="An MCP tool with this name already exists")
    doc = {
        "id": new_id(),
        "company_id": user.company_id,
        "name": payload.name.strip(),
        "display_name": payload.display_name.strip(),
        "description": payload.description.strip(),
        "kind": payload.kind,
        "server_url": payload.server_url.strip(),
        "input_schema": payload.input_schema,
        "enabled_for_employees": payload.enabled_for_employees,
        "requires_human_approval": default_requires_approval(payload.kind, payload.requires_human_approval),
        "created_by": user.email,
        "created_at": utcnow(),
    }
    await db.mcp_tools.insert_one(dict(doc))
    return _mcp_tool(doc)


@router.put("/mcp-tools/{tool_id}", response_model=McpToolPublic)
async def update_mcp_tool(
    tool_id: str, payload: McpToolUpdate, user: CurrentUser = Depends(require_admin)
) -> McpToolPublic:
    existing = await db.mcp_tools.find_one({"id": tool_id, "company_id": user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="MCP tool not found")
    updates = {
        "display_name": payload.display_name.strip(),
        "description": payload.description.strip(),
        "kind": payload.kind,
        "server_url": payload.server_url.strip(),
        "input_schema": payload.input_schema,
        "enabled_for_employees": payload.enabled_for_employees,
        "requires_human_approval": default_requires_approval(payload.kind, payload.requires_human_approval),
    }
    await db.mcp_tools.update_one({"id": tool_id, "company_id": user.company_id}, {"$set": updates})
    return _mcp_tool({**existing, **updates})


@router.delete("/mcp-tools/{tool_id}", status_code=204)
async def delete_mcp_tool(tool_id: str, user: CurrentUser = Depends(require_admin)) -> None:
    result = await db.mcp_tools.delete_one({"id": tool_id, "company_id": user.company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="MCP tool not found")


# ---------------- employees ----------------
async def _login_emails(company_id: str) -> set[str]:
    users = await db.users.find({"company_id": company_id}, {"_id": 0, "email": 1}).to_list(1000)
    return {u["email"].lower() for u in users}


@router.get("/employees", response_model=list[Employee])
async def list_employees(user: CurrentUser = Depends(require_hr_or_admin)) -> list[Employee]:
    docs = await db.employees.find({"company_id": user.company_id}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d["employee_code"])
    emails = await _login_emails(user.company_id)
    return [_employee(d, emails) for d in docs]


@router.post("/employees", response_model=Employee, status_code=201)
async def create_employee(payload: EmployeeCreate, user: CurrentUser = Depends(require_admin)) -> Employee:
    code = await _next_employee_code(user.company_id)
    joining = payload.joining_date
    doc = {
        "id": new_id(),
        "company_id": user.company_id,
        "employee_code": code,
        "name": payload.name.strip(),
        "email": payload.email.lower() if payload.email else None,
        "department": payload.department.strip(),
        "joining_date": joining.isoformat(),
        "service_months": service_months(joining),
        "employment_status": payload.employment_status.strip() or "active",
        "employment_type": payload.employment_type,
        "created_at": utcnow(),
    }
    await db.employees.insert_one(dict(doc))
    return _employee(doc, await _login_emails(user.company_id))


@router.put("/employees/{employee_id}", response_model=Employee)
async def update_employee(
    employee_id: str, payload: EmployeeUpdate, user: CurrentUser = Depends(require_admin)
) -> Employee:
    existing = await db.employees.find_one({"id": employee_id, "company_id": user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Employee not found")
    joining = payload.joining_date
    updates = {
        "name": payload.name.strip(),
        "department": payload.department.strip(),
        "joining_date": joining.isoformat(),
        "service_months": service_months(joining),
        "employment_status": payload.employment_status.strip() or "active",
        "employment_type": payload.employment_type,
    }
    await db.employees.update_one({"id": employee_id, "company_id": user.company_id}, {"$set": updates})
    return _employee({**existing, **updates}, await _login_emails(user.company_id))


@router.delete("/employees/{employee_id}", status_code=204)
async def delete_employee(employee_id: str, user: CurrentUser = Depends(require_admin)) -> None:
    existing = await db.employees.find_one({"id": employee_id, "company_id": user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Employee not found")
    await db.employees.delete_one({"id": employee_id, "company_id": user.company_id})
    if existing.get("email"):
        await db.users.delete_one(
            {"company_id": user.company_id, "email": existing["email"], "role": "employee"}
        )


@router.post("/employees/invite", response_model=InviteResult)
async def invite_employee(
    payload: InviteRequest, request: Request, user: CurrentUser = Depends(require_admin)
) -> InviteResult:
    emp = await db.employees.find_one(
        {"id": payload.employee_id, "company_id": user.company_id}, {"_id": 0}
    )
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    email = (emp.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Add an email address to this employee before inviting")

    token = new_invite_token()
    existing_user = await db.users.find_one({"email": email}, {"_id": 0})
    if existing_user and existing_user["company_id"] != user.company_id:
        raise HTTPException(status_code=409, detail="This email already belongs to another company")

    if existing_user:
        await db.users.update_one(
            {"id": existing_user["id"]},
            {"$set": {"invite_token": token, "employee_code": emp["employee_code"], "password_hash": None}},
        )
    else:
        await db.users.insert_one(
            {
                "id": new_id(),
                "company_id": user.company_id,
                "email": email,
                "role": "employee",
                "employee_code": emp["employee_code"],
                "password_hash": None,
                "invite_token": token,
                "created_at": utcnow(),
            }
        )

    company = await db.companies.find_one({"id": user.company_id}, {"_id": 0})
    invite_url = f"{app_base_url(request)}/invite/{token}"
    sent = await send_email(
        email,
        f"Your {(company or {}).get('name', 'workspace')} compliance account",
        invite_email_html((company or {}).get("name", "your company"), emp["employee_code"], invite_url),
    )
    return InviteResult(email=email, token=token, invite_url=invite_url, email_sent=sent)


# ---------------- policies ----------------
@router.get("/policies", response_model=list[Policy])
async def list_policies(user: CurrentUser = Depends(require_admin)) -> list[Policy]:
    docs = await db.policies.find({"company_id": user.company_id}, {"_id": 0}).to_list(500)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    return [Policy(**{**d, "created_at": _aware(d["created_at"])}) for d in docs]


@router.post("/policies", response_model=Policy, status_code=201)
async def create_policy(payload: PolicyCreate, user: CurrentUser = Depends(require_admin)) -> Policy:
    doc = {
        "id": new_id(),
        "company_id": user.company_id,
        "title": payload.title.strip(),
        "content": payload.content,
        "retrieval_backend": payload.retrieval_backend,
        "created_at": utcnow(),
    }
    await db.policies.insert_one(dict(doc))
    return Policy(**doc)


@router.delete("/policies/{policy_id}", status_code=204)
async def delete_policy(policy_id: str, user: CurrentUser = Depends(require_admin)) -> None:
    result = await db.policies.delete_one({"id": policy_id, "company_id": user.company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Policy not found")


# unused import guard
_ = hash_password
