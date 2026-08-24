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
- `runs` — id, company_id, user_id, query, decision (null for now), cited_evidence,
  tool_called, latency_ms, created_at

## Tenant isolation
Every query in `routers/company.py` and `routers/employee.py` filters on
`user.company_id` taken from the JWT-backed session — including single-document
lookups by id, so guessing another tenant's UUID returns 404.

## Endpoints (all under /api)
- `POST /auth/signup` `POST /auth/login` `POST /auth/logout` `GET /auth/me`
  `GET /auth/invite/{token}` `POST /auth/invite/accept`
- `GET /company/dashboard` `GET /company/runs`
- `GET|POST /company/api-keys`, `POST /company/api-keys/{id}/rotate`,
  `DELETE /company/api-keys/{id}`
- `GET|POST /company/employees`, `PUT|DELETE /company/employees/{id}`,
  `POST /company/employees/invite`
- `GET|POST /company/policies`, `DELETE /company/policies/{id}`
- `GET /employee/profile` `GET /employee/policies` `GET|POST /employee/runs`

## Routes
`/login`, `/signup`, `/invite/:token`, `/company/dashboard`, `/company/employees`,
`/company/policies`, `/company/api-keys`, `/employee/home`, `/employee/history`.

## Seed facts (`python seed.py`)
- Acme Robotics: 5 employees EMP-0001..EMP-0005 with tenure 26/14/8/4/2 months (mix
  above and below the 6-month WFH threshold), one "Work From Home Policy" (general
  2-day allowance + 6-month minimum service clause), one Gemini API key.
- Northwind Labs: 1 employee (NW-0001 Owen Blake), one "Northwind Travel Policy".
- Credentials in `memory/test_credentials.md`.

## Deviations / not built
- Run decisioning, RAG retrieval, and tool calling are intentionally absent — runs are
  stored with `decision=null`.
- Email invites use Resend; `RESEND_API_KEY` in `backend/.env` is empty, so invites
  degrade gracefully and the invite link is shown in the admin UI instead
  (`email_sent: false`). Drop a real `re_...` key into `.env` + restart backend to
  switch on delivery — no code change needed.
- `POST /company/employees/invite` returns `token`; the admin UI composes the link as
  `window.location.origin + /invite/<token>`. Do NOT rely on `APP_URL` or the `Origin`
  header for this — the platform injects a stale `APP_URL` and the ingress rewrites
  `Origin` to an internal cluster host. Both were observed and fixed.
