"""Employee-side endpoints. Runs are recorded with decision=null; AI logic lands later."""
from fastapi import APIRouter, Depends

from lib.db import db
from lib.security import CurrentUser, require_employee
from models.schemas import Employee, Policy, Run, RunCreate, new_id, utcnow
from routers.company import _aware, _as_date, service_months

router = APIRouter(prefix="/employee", tags=["employee"])


@router.get("/profile", response_model=Employee | None)
async def my_profile(user: CurrentUser = Depends(require_employee)) -> Employee | None:
    doc = await db.employees.find_one(
        {"company_id": user.company_id, "employee_code": user.employee_code}, {"_id": 0}
    )
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


@router.post("/runs", response_model=Run, status_code=201)
async def submit_run(payload: RunCreate, user: CurrentUser = Depends(require_employee)) -> Run:
    doc = {
        "id": new_id(),
        "company_id": user.company_id,
        "user_id": user.id,
        "query": payload.query.strip(),
        "decision": None,
        "cited_evidence": [],
        "tool_called": None,
        "latency_ms": None,
        "created_at": utcnow(),
    }
    await db.runs.insert_one(dict(doc))
    return Run(**doc)


@router.get("/runs", response_model=list[Run])
async def my_runs(user: CurrentUser = Depends(require_employee)) -> list[Run]:
    docs = await db.runs.find(
        {"company_id": user.company_id, "user_id": user.id}, {"_id": 0}
    ).to_list(200)
    docs.sort(key=lambda d: _aware(d["created_at"]), reverse=True)
    return [Run(**{**d, "created_at": _aware(d["created_at"])}) for d in docs]
