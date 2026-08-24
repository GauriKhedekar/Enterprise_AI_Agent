# Adaptive Enterprise Agent — living spec

Multi-tenant B2B compliance assistant. Companies onboard, admins manage employees,
policies and AI-provider credentials; employees submit policy questions that are logged
as `runs` (AI decisioning intentionally not built yet).

## Stack
FastAPI + motor/MongoDB backend (`/app/backend`), Vite + React 19 + Tailwind v4 +
shadcn/ui frontend (`/app/frontend`). Auth = bcrypt password + JWT in an httpOnly
cookie (`aea_session`).

## Data model (Mongo collections)
- `companies` — id, name, created_at
- `users` — id, company_id, email, role (`company_admin` | `employee`), employee_code,
  password_hash, invite_token
- `api_keys` — id, company_id, provider (`gemini`|`qdrant`|`pageindex`), encrypted_value
  (Fernet, key derived from `APP_MASTER_KEY`), last_four, label, created_by, created_at,
  rotated_at. **Plaintext is never returned by any endpoint.**
- `employees` — id, company_id, employee_code, name, email, department, joining_date,
  service_months, employment_status
- `policies` — id, company_id, title, content (markdown), retrieval_backend, created_at
- `runs` — id, company_id, user_id, employee_code, employee_name, query, status
  (`running`|`complete`), decision, reasoning, answer, cited_evidence[{text,source,
  match_score}], tool_called, action_taken, policy_required, enterprise_data_required,
  action_required, blocked, trace[{name,status,summary,output,latency_ms}], latency_ms,
  created_at

## Tenant isolation
Every query in `routers/company.py` and `routers/employee.py` filters on
`user.company_id` taken from the JWT-backed session — including single-document
lookups by id, so guessing another tenant's UUID returns 404.

## Endpoints (all under /api)
- `POST /auth/signup` `POST /auth/login` `POST /auth/logout` `GET /auth/me`
  `GET /auth/invite/{token}` `POST /auth/invite/accept`
- `GET /company/dashboard`, `GET /company/runs?page&page_size&decision` (paginated log
  with decision_counts)
- `GET|POST /company/api-keys` (+ optional `endpoint` for the Qdrant cluster URL),
  `POST /company/api-keys/{id}/rotate`, `DELETE /company/api-keys/{id}`
- `GET|POST /company/employees`, `PUT|DELETE /company/employees/{id}`,
  `POST /company/employees/invite`
- `GET|POST /company/policies`, `DELETE /company/policies/{id}`
- `GET /employee/profile` `GET /employee/policies` `GET|POST /employee/runs`
  `GET /employee/runs/{id}` (polled while `status == "running"`)

## Routes
`/login`, `/signup`, `/invite/:token`, `/company/dashboard`, `/company/employees`,
`/company/policies`, `/company/runs`, `/company/api-keys`, `/employee/home`,
`/employee/history`.

## Seed facts (`python seed.py`)
- Acme Robotics: 5 employees EMP-0001..EMP-0005 with tenure 26/14/8/3/1 months (mix
  above and below the 6-month WFH threshold); two policies — "Work From Home Policy"
  (general 2-day allowance + 6-month minimum service clause, tagged **pageindex**) and
  "Leave and Attendance Policy" (accrual + no-leave-on-probation clause, tagged
  **qdrant**); real Gemini, Qdrant (with cluster URL) and PageIndex credentials.
- Northwind Labs: 1 employee (NW-0001 Owen Blake), one "Northwind Travel Policy", and
  **no** API keys — so its pipeline halts at the credential stage by design.
- Credentials in `memory/test_credentials.md`.

## The agent pipeline (`backend/lib/pipeline.py`)
`POST /api/employee/runs` inserts a run with `status="running"` and returns immediately,
then executes 9 stages as an asyncio background task. **This is deliberate: the pipeline
takes 18-50s and the platform ingress hard-caps a single request at 60s (observed as a
502).** Each stage is `$push`ed onto `runs.trace` as it completes, so the UI polls
`GET /api/employee/runs/{id}` every 1.2s and renders genuine per-stage progress.

Stages: credentials → 1 input_guardrail → 2 requirement_classifier → 3 policy_retrieval
→ 4 enterprise_data_lookup → 5 evidence_combiner → 6 decision → 7 tool_gate →
8 output_validation. Stages 3/4 are skipped when the classifier says they aren't needed;
a skipped branch contributes no evidence.

- **Decisions**: ALLOW | DENY | NOT_ELIGIBLE | INSUFFICIENT_INFO, plus **BLOCKED**
  (added for guardrail rejections, which stop the pipeline at stage 1).
- **Citation validation** (`validate_citations`) is server-side and non-LLM: each claimed
  citation must reach ≥0.62 token recall against an actually-retrieved passage or the HR
  record, else it is stripped and listed in the trace as `stripped_citations`.
- **Tool gate** is plain code: `action_taken` requires decision==ALLOW AND
  action_required AND the referenced employee_code was genuinely retrieved in stage 4.
  A model-invented code sets `hallucinated_code_flagged` and refuses the action.
- **Retrieval** (`backend/lib/retrieval.py`): policies are chunked by markdown heading
  with the heading path preserved. `qdrant` embeds via `gemini-embedding-001` (3072-dim)
  and vector-searches the tenant's cluster (collection per tenant + a `company_id`
  keyword-indexed payload filter). `pageindex` does tree-reasoning retrieval: Gemini
  selects heading-tree node paths and whole sections are returned.
- **Gemini** (`backend/lib/gemini.py`): direct REST with the tenant's decrypted key,
  structured `responseSchema` JSON. Keys are redacted from every error/log. Free-tier
  quota is **20 requests per model per day**, so `GEMINI_MODELS` is an ordered fallback
  chain and a per-day 429 marks that model exhausted for the process.

## Backend comparison (`/company/compare`)
`POST /api/company/compare {queries:[≤5]}` runs each query through **both** retrieval
backends over the **same** policy set (each policy's `retrieval_backend` tag is ignored
here — that is the point of the page), then reports per-backend decision, retrieved
section paths, latency, plus `decisions_agree` and Jaccard `evidence_overlap` of the
retrieved section paths. `GET /api/company/compare/suggestions` lists distinct past
queries; a query matching a past run reuses that asker's `employee_code` so HR-dependent
decisions are reproducible.

Comparison mode deliberately runs only **retrieval → decision** (~2 Gemini calls per
backend), not all 9 stages: divergence originates in retrieval and the guardrail/
classifier/combiner/validation stages are backend-independent. This matters on a
quota-limited key. Stats: `agreement_rate`, `avg_latency_{qdrant,pageindex}_ms`,
`avg_evidence_overlap`.

## Deviations / not built
- **PageIndex cloud API is not called.** The PageIndex key is stored and the branch is
  selected by `retrieval_backend`, but retrieval runs as local heading-tree reasoning
  rather than `api.pageindex.ai` (its cloud SDK ingests PDFs, while policies here are
  markdown). Swapping in the HTTP client is isolated to `pageindex_retrieve()`.
- Gemini free tier means ~13 queries/day across all 4 fallback models. Enabling billing
  on the Google project removes the cap; no code change needed.
- Email invites use Resend; `RESEND_API_KEY` in `backend/.env` is empty, so invites
  degrade gracefully and the invite link is shown in the admin UI instead
  (`email_sent: false`).
- `POST /company/employees/invite` returns `token`; the admin UI composes the link as
  `window.location.origin + /invite/<token>`. Do NOT rely on `APP_URL` or the `Origin`
  header — the platform injects a stale `APP_URL` and the ingress rewrites `Origin`.
