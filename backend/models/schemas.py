"""Pydantic v2 request/response models. Each has a hand-written TS mirror in frontend/src/lib/types.ts."""
import uuid
from datetime import date, datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Provider = Literal["gemini", "qdrant", "pageindex"]
Backend = Literal["qdrant", "pageindex"]
Role = Literal["company_admin", "employee"]


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------- auth ----------
class SignupRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class SetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=6, max_length=72)


class Me(BaseModel):
    id: str
    company_id: str
    company_name: str
    email: str
    role: Role
    employee_code: Optional[str] = None


class InviteInfo(BaseModel):
    email: str
    company_name: str
    employee_code: str


# ---------- api keys ----------
class ApiKeyCreate(BaseModel):
    provider: Provider
    label: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=4, max_length=500)


class ApiKeyRotate(BaseModel):
    value: str = Field(min_length=4, max_length=500)


class ApiKeyPublic(BaseModel):
    """Masked view — the decrypted value is never serialised."""
    id: str
    provider: Provider
    label: str
    last_four: str
    created_by: str
    created_at: datetime
    rotated_at: Optional[datetime] = None


# ---------- employees ----------
class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: Optional[EmailStr] = None
    department: str = Field(min_length=1, max_length=80)
    joining_date: date
    employment_status: str = Field(default="active", max_length=40)


class EmployeeUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    department: str = Field(min_length=1, max_length=80)
    joining_date: date
    employment_status: str = Field(max_length=40)


class Employee(BaseModel):
    id: str
    company_id: str
    employee_code: str
    name: str
    email: Optional[str] = None
    department: str
    joining_date: date
    service_months: int
    employment_status: str
    has_login: bool = False


class InviteRequest(BaseModel):
    employee_id: str


class InviteResult(BaseModel):
    email: str
    token: str
    invite_url: str
    email_sent: bool


# ---------- policies ----------
class PolicyCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    content: str = Field(min_length=1)
    retrieval_backend: Backend


class Policy(BaseModel):
    id: str
    company_id: str
    title: str
    content: str
    retrieval_backend: Backend
    created_at: datetime


# ---------- runs ----------
class RunCreate(BaseModel):
    query: str = Field(min_length=3, max_length=2000)


class Run(BaseModel):
    id: str
    company_id: str
    user_id: str
    query: str
    decision: Optional[str] = None
    cited_evidence: list[dict[str, Any]] = Field(default_factory=list)
    tool_called: Optional[str] = None
    latency_ms: Optional[int] = None
    created_at: datetime


# ---------- dashboard ----------
class DashboardStats(BaseModel):
    company_name: str
    employee_count: int
    policy_count: int
    keys_configured: int
    providers_configured: list[str]
    run_count: int
    pending_invites: int
