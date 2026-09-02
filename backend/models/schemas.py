"""Pydantic v2 request/response models. Each has a hand-written TS mirror in frontend/src/lib/types.ts."""
import uuid
from datetime import date, datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Provider = Literal["gemini", "qdrant", "pageindex"]
Backend = Literal["qdrant", "pageindex"]
Role = Literal["company_admin", "hr", "employee"]
McpToolKind = Literal["read", "action"]
EmploymentType = Literal["full_time", "part_time", "contract"]


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
    value: str = Field(min_length=4, max_length=2000)
    # Qdrant needs a cluster URL alongside the key; ignored for other providers.
    endpoint: Optional[str] = Field(default=None, max_length=300)


class ApiKeyRotate(BaseModel):
    value: str = Field(min_length=4, max_length=2000)


class ApiKeyPublic(BaseModel):
    """Masked view — the decrypted value is never serialised."""
    id: str
    provider: Provider
    label: str
    last_four: str
    endpoint: Optional[str] = None
    created_by: str
    created_at: datetime
    rotated_at: Optional[datetime] = None


# ---------- MCP tools ----------
class McpToolCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    kind: McpToolKind
    server_url: str = Field(min_length=4, max_length=300)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    enabled_for_employees: bool = True
    requires_human_approval: Optional[bool] = None


class McpToolUpdate(BaseModel):
    display_name: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    kind: McpToolKind
    server_url: str = Field(min_length=4, max_length=300)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    enabled_for_employees: bool = True
    requires_human_approval: Optional[bool] = None


class McpToolPublic(BaseModel):
    id: str
    company_id: str
    name: str
    display_name: str
    description: str
    kind: McpToolKind
    server_url: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    enabled_for_employees: bool
    requires_human_approval: bool = False
    created_by: str
    created_at: datetime


# ---------- action requests ----------
ActionRequestStatus = Literal["pending", "approved", "rejected"]


class ActionRequestPublic(BaseModel):
    id: str
    company_id: str
    employee_id: str
    employee_code: str
    employee_name: Optional[str] = None
    tool_name: str
    tool_call_args: dict[str, Any] = Field(default_factory=dict)
    run_id: str
    status: ActionRequestStatus
    requested_at: datetime
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    resolution_note: Optional[str] = None
    executed_result: Optional[dict[str, Any]] = None


class ActionRequestResolution(BaseModel):
    resolution_note: Optional[str] = Field(default=None, max_length=1000)


# ---------- employees ----------
class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: Optional[EmailStr] = None
    department: str = Field(min_length=1, max_length=80)
    joining_date: date
    employment_status: str = Field(default="active", max_length=40)
    employment_type: EmploymentType = "full_time"


class EmployeeUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    department: str = Field(min_length=1, max_length=80)
    joining_date: date
    employment_status: str = Field(max_length=40)
    employment_type: EmploymentType = "full_time"


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
    employment_type: EmploymentType = "full_time"
    has_login: bool = False


class InviteRequest(BaseModel):
    employee_id: str


class InviteResult(BaseModel):
    email: str
    token: str
    invite_url: str
    email_sent: bool


# ---------- team (company admins + HR) ----------
class TeamMember(BaseModel):
    id: str
    email: str
    role: Role
    employee_code: Optional[str] = None
    status: Literal["active", "invited"]


class TeamInviteRequest(BaseModel):
    email: EmailStr


# ---------- WFH weekly usage (employee meter) ----------
class WfhUsage(BaseModel):
    week_start: str
    week_end: str
    cap: int
    used_days: list[str] = Field(default_factory=list)
    remaining: int


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


class CitedEvidence(BaseModel):
    text: str
    source: str
    match_score: Optional[float] = None


class TraceStage(BaseModel):
    name: str
    status: str
    summary: str
    output: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0


class Run(BaseModel):
    id: str
    company_id: str
    user_id: str
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    query: str
    status: str = "complete"
    decision: Optional[str] = None
    reasoning: str = ""
    answer: str = ""
    cited_evidence: list[CitedEvidence] = Field(default_factory=list)
    tool_called: Optional[str] = None
    action_taken: bool = False
    policy_required: Optional[bool] = None
    enterprise_data_required: Optional[bool] = None
    action_required: Optional[bool] = None
    blocked: bool = False
    trace: list[TraceStage] = Field(default_factory=list)
    latency_ms: Optional[int] = None
    created_at: datetime


class PaginatedRuns(BaseModel):
    items: list[Run]
    total: int
    page: int
    page_size: int
    pages: int
    decision_counts: dict[str, int] = Field(default_factory=dict)


# ---------- dashboard ----------
class CompareRequest(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=5)


class BackendResult(BaseModel):
    backend: str
    decision: Optional[str] = None
    reasoning: str = ""
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    cited_evidence: list[CitedEvidence] = Field(default_factory=list)
    latency_ms: int = 0
    error: Optional[str] = None


class CompareCase(BaseModel):
    query: str
    employee_code: Optional[str] = None
    qdrant: BackendResult
    pageindex: BackendResult
    decisions_agree: bool
    evidence_overlap: float = 0.0


class CompareStats(BaseModel):
    total: int
    compared: int
    agreements: int
    agreement_rate: float
    avg_latency_qdrant_ms: int
    avg_latency_pageindex_ms: int
    avg_evidence_overlap: float


class CompareResponse(BaseModel):
    cases: list[CompareCase]
    stats: CompareStats


class DashboardStats(BaseModel):
    company_name: str
    employee_count: int
    policy_count: int
    keys_configured: int
    providers_configured: list[str]
    run_count: int
    pending_invites: int
    mcp_tools_enabled: int = 0
