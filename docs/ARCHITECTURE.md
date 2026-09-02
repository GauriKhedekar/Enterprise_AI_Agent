# Architecture & design

- [Design goals](#design-goals)
- [Data model](#data-model)
- [Multi-tenancy](#multi-tenancy-how-isolation-is-enforced)
- [Authentication](#authentication)
- [Secret handling](#secret-handling)
- [The pipeline](#the-decision-pipeline)
- [Retrieval abstraction](#retrieval-abstraction)
- [Async execution](#why-runs-execute-asynchronously)
- [Request flow](#end-to-end-request-flow)
- [File-by-file map](#file-by-file-map)
- [Key decisions & trade-offs](#key-decisions-and-trade-offs)

---

## Design goals

1. **Tenant isolation is non-negotiable.** Enforced at the API layer on every endpoint,
   never in the UI. Guessing another tenant's UUID must return `404`.
2. **No unfalsifiable AI claims.** Every decision carries citations that are validated
   against actually-retrieved text by *code*, not by asking the model to behave.
3. **Auditable by the person affected.** The employee who was denied can see the clause
   that denied them. That is the product, not a debug feature.
4. **Never trust the model with authority.** Actions and privacy boundaries are enforced
   in plain Python, positioned *after* the model has spoken.

---

## Data model

MongoDB, six collections. Every document except `companies` carries `company_id`.

| Collection | Fields |
|---|---|
| `companies` | `id`, `name`, `created_at` |
| `users` | `id`, `company_id`, `email` (unique), `role`, `employee_code`, `password_hash`, `invite_token` |
| `api_keys` | `id`, `company_id`, `provider`, `encrypted_value`, `last_four`, `endpoint`, `label`, `created_by`, `created_at`, `rotated_at` |
| `employees` | `id`, `company_id`, `employee_code`, `name`, `email`, `department`, `joining_date`, `service_months`, `employment_status`, `employment_type` (`full_time`\|`part_time`\|`contract`) |
| `policies` | `id`, `company_id`, `title`, `content` (markdown), `retrieval_backend`, `created_at` |
| `runs` | `id`, `company_id`, `user_id`, `employee_code`, `query`, `status`, `decision`, `reasoning`, `answer`, `cited_evidence[]`, `tool_called`, `action_taken`, the three classifier booleans, `trace[]`, `latency_ms`, `created_at` |

**Why Mongo?** `runs.trace[].output` is a different shape for every stage — the classifier
emits three booleans, retrieval emits scored chunks, the tool gate emits verification
state. Modelling that relationally means a JSONB column or nine tables; the document model
fits it natively. Everything else is straightforward CRUD.

**`service_months` is derived, never trusted.** It is stored for reference but recomputed
from `joining_date` server-side on every read (`routers/company.py::service_months`). A
stale tenure figure would silently corrupt every eligibility decision — and client-side
date math would let a user's clock change the answer.

**Indexes** (created on startup in `server.py`): unique on `users.email`; `company_id` on
`users`, `api_keys`, `policies`, `runs`; compound `(company_id, employee_code)` on
`employees`.

---

## Multi-tenancy: how isolation is enforced

`company_id` is read from the **signed JWT cookie**, never from the request body or a
query parameter, so a client cannot assert which tenant it belongs to.

```python
# lib/security.py
async def current_user(aea_session: str | None = Cookie(default=None)) -> CurrentUser:
    payload = jwt.decode(aea_session, _jwt_secret(), algorithms=["HS256"])
    doc = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    return CurrentUser(doc)

async def require_admin(user = Depends(current_user)):   # 403 unless company_admin
async def require_employee(user = Depends(current_user)) # 403 unless employee
```

The critical detail: **`company_id` is part of the filter on single-document lookups**, not
just list queries.

```python
# a scoped lookup: wrong tenant -> no match -> 404, never another tenant's row
existing = await db.api_keys.find_one({"id": key_id, "company_id": user.company_id})
if not existing:
    raise HTTPException(status_code=404, detail="API key not found")
```

The same pattern guards employees, policies, runs, and the Qdrant vector store, which uses
a per-tenant collection **and** a `company_id` payload filter (defence in depth — see
`retrieval.py::qdrant_retrieve`).

Verified: Northwind Labs' admin sees 0 runs and 1 employee; `DELETE` on an Acme policy id
returns 404; an employee fetching another user's run id gets 404.

---

## Authentication

- **bcrypt** password hashing (passlib, 10 rounds), inputs truncated to bcrypt's 72-byte limit.
- **JWT** (HS256, 7-day expiry) carrying `sub`, `cid`, `role`.
- Delivered in an **httpOnly, Secure, SameSite=None** cookie. Because JavaScript can never
  read the token, an XSS bug cannot exfiltrate the session. `SameSite=None` is required as
  the preview frontend and API are served across origins.
- No open employee signup: an admin issues a single-use `invite_token`; accepting it sets
  the password and clears the token, so invite links cannot be replayed.

---

## Secret handling

Provider keys are **per-tenant data**, not deployment config.

- Encrypted with **Fernet** (AES-128-CBC + HMAC). The key is derived as
  `base64(sha256(APP_MASTER_KEY))`, so the env var can be any length string.
- `last_four` is stored separately at write time; the masked list is built from it, so the
  API **never decrypts for a read path**.
- `ApiKeyPublic` — the response model — has no field capable of carrying the plaintext.
  The masking is structural, not a filter someone can forget to apply.
- Decryption happens only inside `pipeline.py` immediately before an outbound provider
  call. `lib/gemini.py::_redact` strips the key from every error string and log line.

> Rotating `APP_MASTER_KEY` makes stored keys undecryptable — they must be re-entered.
> A production system would use envelope encryption with a versioned KMS key.

---

## The decision pipeline

`lib/pipeline.py`. Stages 3 and 4 are conditional on the stage-2 classifier; a skipped
branch contributes no evidence, exactly as specified.

```
credentials → 1 guardrail → 2 classifier ─┬─→ 3 policy retrieval ─┐
                                          └─→ 4 HR lookup ────────┴→ 5 combiner
                                                     → 6 decision → 7 tool gate → 8 output validation
```

### The three code-enforced guardrails

**1. Citation validation** (`validate_citations`) — token-recall of each claimed citation
against every retrieved passage; ≥0.62 keeps it (annotated with its source and score),
below that strips it into `stripped_citations`. Chosen over exact string matching because
models paraphrase whitespace and punctuation, and over embedding similarity because this
must be cheap, deterministic and explainable.

**2. Tool gate** (plain code, no LLM) — `action_taken` requires **all** of:
`decision == "ALLOW"` ∧ `action_required` ∧ the referenced `employee_code` was genuinely
retrieved in stage 4. A code the model invented sets `hallucinated_code_flagged=true` and
the action is refused. This is the single most important line of defence: an LLM that
hallucinates an approval must not be able to *cause* one.

**3. PII leak scan** (`_detect_pii_leak`) — scans the final answer against the tenant
directory for any *other* employee's full name or email. A hit replaces the answer with a
refusal and clears citations. This runs **regardless of what the LLM validator says**,
because stage 8 asking the model "did you leak data?" is not a control — it's a suggestion.
Requires ≥2 name tokens so a shared given name doesn't false-positive.

Additionally, a third-party lookup in stage 4 returns a **minimised projection**
(`employee_code`, `department`, `service_months`, `employment_status`, `employment_type`) —
never name, email or joining date.

### Two eligibility rules enforced in code

**Weekly WFH cap (`_wfh_days_used_this_week` + tool gate).** The 2-day-per-calendar-week
allowance is cumulative, so it cannot be judged from one request's text. Before the decision
stage the pipeline injects a "WFH request ledger" evidence item counting the requester's
approved **and** pending WFH days for the requested week (from `action_requests`, excluding
the current run); the `tool_gate` then re-checks deterministically and, if `used + this
request > 2`, refuses the action and **overrides the decision to `DENY`** (trace records
`weekly_cap_exceeded`). Approved *and* pending both consume the allowance, so two in-flight
requests can't both slip through.

**`employment_type`.** Carried into the decision evidence so a clause scoped to "full-time
employees" is genuinely checkable — a 30-month *contract* worker passes the service rule but
fails the full-time condition, rather than being implicitly assumed eligible.

---

## Retrieval abstraction

Both backends consume the same chunker and return the same shape
(`{source, text, score, backend}`), so they are directly comparable.

**Chunking** (`split_sections`) walks the Markdown heading hierarchy and emits each section
with its full heading path (`"WFH Policy > 2. Minimum Service Requirement"`). Preserving
the path matters: a citation that names its clause is auditable, one that quotes floating
text is not. Sections over 900 chars are split further.

**`qdrant`** — embeds all chunks + the query with `gemini-embedding-001` (3072-dim),
upserts into a per-tenant collection (`aea_policies_<sha1>`), and runs cosine search with a
`company_id` payload filter. Point ids are `uuid5` of the chunk key, so re-indexing is
idempotent. A filterable payload key needs an explicit Qdrant index — created idempotently
on every call, because a collection created before that code existed would otherwise 400.

**`pageindex`** — structure-aware retrieval: the heading tree is given to Gemini, which
selects relevant node paths, and whole sections are returned. Returns fewer, larger,
semantically-complete units rather than top-k fragments.

> **Deviation:** the PageIndex *cloud* API is not called. Its SDK ingests PDFs while
> policies here are Markdown. Rather than ship an unverified request shape, this backend
> implements PageIndex's tree-reasoning approach locally. Swapping in the HTTP client is
> confined to `pageindex_retrieve()`.

---

## Why runs execute asynchronously

`POST /api/employee/runs` inserts a run with `status="running"`, schedules
`asyncio.create_task(_execute(...))`, and returns `201` immediately. Each stage is
`$push`ed onto `runs.trace` as it completes; the client polls
`GET /api/employee/runs/{id}` every 1.2s until `status == "complete"`.

**This was a measured fix, not a preference.** Six sequential Gemini calls take 7–22s
(worst observed 22.4s). The platform ingress hard-caps a single request at 60s and returned
a **502** under load. Streaming stage-by-stage progress also turns a mandatory wait into
visible, trustworthy feedback.

Trade-off: an in-process `asyncio` task dies with the worker. If the task **raises**, the
run is caught and resolved to `status="error"` (verified in `tests/test_hardening.py`), so
a crashing pipeline no longer hangs at `running`. A hard worker kill mid-flight is still not
covered — production would move this to a durable queue (Celery / Arq / SQS) with a reaper
for stale runs; the stage-emit callback is already the right seam.

---

## End-to-end request flow

```
Employee submits "Am I eligible to work from home two days a week?"
  │
  ├─ POST /api/employee/runs        → 201 {id, status:"running"} in ~20ms
  │    └─ background task starts
  │
  ├─ GET /api/employee/runs/{id}    → poll every 1.2s
  │    ├─ trace:[credentials]                        (~2ms)
  │    ├─ trace:[…, input_guardrail]                 (~1.5s)  safe → continue
  │    ├─ trace:[…, requirement_classifier]          (~2.1s)  policy✓ data✓ action✗
  │    ├─ trace:[…, policy_retrieval]                (~2.6s)  6 sections
  │    ├─ trace:[…, enterprise_data_lookup]          (<1ms)   EMP-0001, 26 months
  │    ├─ trace:[…, evidence_combiner]               (~3.2s)
  │    ├─ trace:[…, decision]                        (~3.8s)  ALLOW + 3 citations
  │    ├─ trace:[…, tool_gate]                       (0ms)    code verified
  │    └─ trace:[…, output_validation] status:done   (~2.2s)  grounded
  │
  └─ UI renders badge + answer + expandable trace
```

---

## File-by-file map

### Backend (`backend/`)

| File | Responsibility |
|---|---|
| `server.py` | App factory, CORS, startup index creation, mounts one `APIRouter(prefix="/api")`. `app.include_router(api_router)` is the last statement — anything registered after it is never served. |
| `seed.py` | Idempotent demo data: two tenants, 5 employees with mixed tenure, 2 policies (one per backend), encrypted provider keys. |
| `lib/db.py` | Motor client and `db` handle. |
| `lib/dates.py` | Server-anchored "today" — all tenure math derives from here. |
| `lib/security.py` | bcrypt hashing, JWT issue/verify, `current_user` / `require_admin` / `require_employee` dependencies, Fernet encrypt/decrypt, `last4`. |
| `lib/gemini.py` | Gemini REST client: structured-JSON `responseSchema` calls, batch embeddings, retry with `retryDelay`, per-model daily-quota detection and cross-model fallback, key redaction. |
| `lib/retrieval.py` | Markdown heading-path chunker, `qdrant_retrieve` (embed → upsert → filtered cosine search), `pageindex_retrieve` (heading-tree reasoning). |
| `lib/pipeline.py` | The 9 stages, `Stage` timing helper, `validate_citations`, `_detect_pii_leak`, `_employee_facts` minimisation, and `compare_backends` for the comparison page. |
| `lib/mailer.py` | Resend invite email; degrades to log-only when unconfigured. |
| `models/schemas.py` | All Pydantic v2 request/response models. `ApiKeyPublic` structurally cannot carry a plaintext secret. |
| `routers/auth.py` | signup, login, logout, `/me`, invite lookup/accept, cookie helpers. |
| `routers/company.py` | Admin surface: dashboard stats, paginated run log, API-key CRUD + rotate, employee CRUD + invite, policy CRUD, backend comparison. Also owns `service_months` and the date coercion helpers. |
| `routers/employee.py` | Employee surface: profile, visible policies, run submit (schedules the background task), run list, single-run polling endpoint. |
| `tests/test_guardrails.py` | Unit tests for `validate_citations` and `_detect_pii_leak`. |

### Frontend (`frontend/src/`)

| File | Responsibility |
|---|---|
| `main.tsx` | Mounts `QueryClientProvider` + `BrowserRouter`. |
| `App.tsx` | Route table; every private route wrapped in `RequireRole`. |
| `lib/api.ts` | Typed fetch helpers over relative `/api` paths; throws `ApiError` carrying the parsed body. |
| `lib/types.ts` | Hand-written TypeScript mirrors of every Pydantic model. There is no codegen — `yarn typecheck` is what catches drift. |
| `lib/session.ts` | `useMe()`, `homeFor(role)` role routing, `useEndSession()`. |
| `components/RequireRole.tsx` | Guards a route: loading → verifying, unauthenticated → `/login`, wrong role → that role's home. |
| `components/AppShell.tsx` | Sidebar + header shell; navigation items differ per role. |
| `components/DecisionBadge.tsx` | Colour-coded decision badge; exposes `data-decision` for tests. |
| `components/RunTrace.tsx` | Reasoning, citations, and the collapsible stage list with raw JSON. |
| `components/PipelineProgress.tsx` | Renders *real* progress from the polled trace plus the pending stages. |
| `components/EmptyState.tsx`, `AuthLayout.tsx` | Shared empty state and split auth layout. |
| `pages/Login/Signup/AcceptInvite` | Auth screens. |
| `pages/CompanyDashboard.tsx` | Counts, provider status, recent runs. |
| `pages/CompanyEmployees.tsx` | Directory table, add/edit/delete, invite dialog. |
| `pages/CompanyPolicies.tsx` | Policy list + markdown editor + backend tag. |
| `pages/CompanyApiKeys.tsx` | Masked key table, add (with Qdrant URL), rotate, revoke. |
| `pages/CompanyRuns.tsx` | Paginated, filterable run log with expandable traces. |
| `pages/CompanyCompare.tsx` | Backend comparison: query picker, summary stats, divergence cards. |
| `pages/EmployeeHome.tsx` | Ask box, polling, decision card, trace panel. |
| `pages/EmployeeHistory.tsx` | Past requests with traces. |

### Other

| Path | Purpose |
|---|---|
| `scripts/ask.sh` | Submit a query and poll to completion, printing the trace. |
| `scripts/adversarial.sh` | Adversarial guardrail probes with full trace output. |
| `memory/SPEC.md` | Living spec. |
| `memory/test_credentials.md` | Working logins. |
| `docs/` | This documentation set. |

> **Pod conventions:** `backend`, `frontend` and `mongodb` run under supervisor. Code edits
> hot-reload (uvicorn `--reload`, Vite HMR); restart only after `.env` or dependency
> changes: `sudo supervisorctl restart backend frontend`. Logs:
> `/var/log/supervisor/{backend,frontend}.err.log`. Frontend typecheck must be
> `cd frontend && yarn typecheck` (the root tsconfig uses project references, so a bare
> `tsc --noEmit` checks zero files).

---

## Key decisions and trade-offs

| Decision | Rationale | Cost |
|---|---|---|
| Async runs + polling | 6 LLM calls exceed the 60s ingress cap (observed 502) | In-process tasks aren't durable; needs a real queue at scale |
| Separate LLM call per stage | Isolates failures, makes each step independently auditable | 6× latency and quota vs one mega-prompt |
| Hand-written TS mirrors | Zero codegen infrastructure | Drift risk, mitigated only by `yarn typecheck` |
| Token-recall citation check | Cheap, deterministic, explainable | Paraphrases below threshold are dropped |
| Per-tenant Qdrant collection | Hard isolation boundary | Many small collections at scale |
| `last_four` stored at write | Read path never decrypts | Denormalised field |
| Comparison runs retrieval→decision only | Divergence originates in retrieval; ~3× cheaper | Not a full end-to-end A/B |
| Mongo over Postgres | Heterogeneous trace documents | No FK guarantees; isolation rests on query discipline |
