# Adaptive Enterprise Agent

A multi-tenant B2B SaaS compliance assistant. Companies onboard their own workspace,
administrators publish policy documents and provider credentials, and employees ask
natural-language policy questions ("Am I eligible to work from home two days a week?").
Each question runs through a **9-stage grounded-decision pipeline** that retrieves policy
clauses, reads the employee's HR record, decides, and shows its full reasoning trace.

> Every answer is auditable. The employee sees *why* they got a decision; the admin sees
> every stage, every retrieved clause and every latency for every query in their tenant.

**Live demo (dev preview):** https://governed-hr-flow.preview.emergentagent.com

> This is a development preview. The app is built to run **fully independently of this
> preview** on free-tier infrastructure — backend on Render, frontend on Vercel, database
> on MongoDB Atlas. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the turnkey steps and
> replace this link with your own Vercel URL once deployed.

| Role | Email | Password |
|---|---|---|
| Company admin | `gauri.khedekar.entc.2023@vpkbiet.org` | `admin123` |
| HR | `hr@acmerobotics.com` | `hr12345` |
| Employee (26 months tenure → ALLOW) | `priya.sharma@acmerobotics.com` | `employee123` |
| Employee (2 months tenure → NOT_ELIGIBLE) | `hannah.weber@acmerobotics.com` | `hannah123` |
| Second tenant (proves isolation) | `admin@northwindlabs.com` | `northwind123` |

---

## Table of contents

- [What it does](#what-it-does)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [The decision pipeline](#the-decision-pipeline)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Testing](#testing)
- [Documentation](#documentation)
- [Known limits](#known-limits)

---

## What it does

**For company administrators**
- **Workspace signup** — creates the company and its first admin in one step.
- **Employee directory** — CRUD with server-computed `service_months` and an
  `employment_type` (full-time / part-time / contract), plus invite-only onboarding
  (employees cannot self-register).
- **Policy base** — author Markdown policies and tag each with a retrieval backend.
- **Provider credentials** — store Gemini / Qdrant / PageIndex keys, encrypted at rest.
  Only the **last 4 characters** are ever returned, to anyone, including the creator.
- **Agent run log** — paginated, filterable by decision, every row expandable to the full
  stage-by-stage trace with raw JSON per stage.
- **Backend comparison** — run the same queries through Qdrant *and* PageIndex side by
  side and see where evidence and decisions diverge.

**For employees**
- **Compliance assistant** — ask a question, watch the pipeline progress stage by stage,
  then get a colour-coded decision (ALLOW / DENY / NOT_ELIGIBLE / INSUFFICIENT_INFO /
  BLOCKED) with an expandable "how this was decided" trace.
- **My requests** — history of every question with its decision and full trace.

**Multi-tenancy** — every query on every collection is scoped by the `company_id` taken
from the session token, enforced at the API layer on **every** endpoint. Guessing another
tenant's UUID returns `404`, not their data.

---

## Screenshots

| | |
|---|---|
| ![Login](docs/screenshots/01-login.jpg) **Shared login** | ![Dashboard](docs/screenshots/02-admin-dashboard.jpg) **Admin overview** |
| ![Pipeline](docs/screenshots/07-pipeline-progress.jpg) **Live pipeline progress** | ![Decision](docs/screenshots/08-decision-badge.jpg) **Grounded decision** |
| ![Trace](docs/screenshots/11-run-trace-expanded.jpg) **Full reasoning trace** | ![Compare](docs/screenshots/13-compare-stats.jpg) **Backend comparison** |

Full annotated set: [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript (strict) + Tailwind v4 + shadcn/ui       │
│  TanStack Query · relative /api calls · httpOnly cookie session │
└───────────────────────────┬─────────────────────────────────────┘
                            │  /api/*  (Vite proxy → :8001)
┌───────────────────────────┴─────────────────────────────────────┐
│  FastAPI — one APIRouter(prefix="/api")                         │
│  routers/auth.py · routers/company.py · routers/employee.py     │
│  ── every handler resolves company_id from the JWT cookie ──    │
├─────────────────────────────────────────────────────────────────┤
│  lib/pipeline.py   9-stage agent + citation & PII guardrails    │
│  lib/retrieval.py  qdrant (vectors) │ pageindex (heading tree)  │
│  lib/gemini.py     REST client, per-tenant key, model fallback  │
│  lib/security.py   bcrypt · JWT · Fernet field encryption       │
└──────────┬─────────────────────────┬────────────────────────────┘
           │                         │
     ┌─────┴──────┐          ┌───────┴────────┐
     │  MongoDB   │          │ Gemini · Qdrant│
     │ (6 colls)  │          │   (external)   │
     └────────────┘          └────────────────┘
```

Full design rationale and a file-by-file map: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## The decision pipeline

`POST /api/employee/runs` returns immediately with `status="running"` and executes the
pipeline as a background task, persisting each stage as it completes. The UI polls
`GET /api/employee/runs/{id}` and renders genuine progress.

> **Why async?** The full pipeline takes 7–50s. The platform ingress hard-caps a single
> request at 60s — the synchronous version returned **502**. This was found in testing,
> not guessed.

| # | Stage | Kind | Purpose |
|---|---|---|---|
| 0 | `credentials` | code | Load + decrypt the tenant's Gemini key |
| 1 | `input_guardrail` | LLM | Screen for prompt injection, unsafe instructions, off-topic → halt |
| 2 | `requirement_classifier` | LLM | 3 independent booleans: policy / enterprise-data / action needed |
| 3 | `policy_retrieval` | LLM+DB | Retrieve clauses via the policy's tagged backend (skippable) |
| 4 | `enterprise_data_lookup` | code | Tenant-scoped HR record; minimised projection for third parties (skippable) |
| 5 | `evidence_combiner` | LLM | Merge policy + HR evidence into a neutral summary |
| 6 | `decision` | LLM | Structured JSON decision + reasoning + citations |
| 7 | `tool_gate` | **code** | Execute an action *only* if ALLOW ∧ action_required ∧ code verified |
| 8 | `output_validation` | LLM+**code** | Grounding audit + deterministic PII leak scan |

**Three guardrails that never trust the model:**
1. **Citation validation** — every claimed citation must reach ≥0.62 token recall against
   actually-retrieved text, or it is stripped and logged as `stripped_citations`.
2. **Tool gate** — plain code. A model-invented `employee_code` sets
   `hallucinated_code_flagged` and the action is refused.
3. **PII scan** — the final answer is scanned against the tenant directory; another
   employee's name or email replaces the answer with a refusal.

**Two eligibility rules enforced in code, not left to the model:**
- **Weekly WFH cap (2 days/calendar week)** — the tool gate counts the requester's approved
  **and** pending WFH days for the requested week from the `action_requests` ledger; a
  request that would exceed the cap is refused and the decision overridden to `DENY`, even
  when it looks fine read in isolation. The same count is injected as evidence so the
  decision model sees the cumulative total.
- **`employment_type`** — passed into the decision evidence, so a policy clause scoped to
  "full-time employees" is genuinely checkable (a long-tenure *contract* worker fails it).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | FastAPI, async throughout | Pydantic v2 validates every body; native async for 6 sequential LLM calls |
| DB | MongoDB (motor) | Schemaless run traces vary in shape per stage |
| LLM | Gemini via REST (`gemini-3-flash-preview` + fallbacks) | Native `responseSchema` structured JSON, no parsing hacks |
| Vectors | Qdrant Cloud | Managed HNSW; per-tenant collections |
| Embeddings | `gemini-embedding-001` (3072-dim) | One provider for chat + embeddings |
| Frontend | React 19, TS strict, Tailwind v4, shadcn/ui | Typed API boundary; dense Linear-style dashboard |
| Data fetching | TanStack Query | Polling with `refetchInterval`, cache invalidation |
| Auth | bcrypt + JWT in httpOnly cookie | No token in JS → no XSS token theft |
| Secrets | Fernet (key from env) | Provider keys encrypted at rest, never returned |

---

## Running locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | backend |
| Node.js | 20+ (24 recommended) | frontend |
| Yarn | 1.22+ | `npm i -g yarn` — **use yarn, not npm** (the lockfile is `yarn.lock`) |
| MongoDB | 6+ | local, Docker, or a free Atlas cluster |

### 1. Clone

```bash
git clone https://github.com/GauriKhedekar/Enterprise_AI_Agent.git
cd Enterprise_AI_Agent
```

### 2. Start MongoDB

Pick whichever you prefer:

```bash
# Option A — Docker (no install)
docker run -d --name aea-mongo -p 27017:27017 mongo:7

# Option B — already installed locally
mongod --dbpath /your/data/path

# Option C — MongoDB Atlas (free tier)
# create a cluster, then use its connection string as MONGO_URL in step 3
```

### 3. Configure the backend

```bash
cd backend
cp .env.example .env
```

Open `.env` and set, at minimum:

```ini
MONGO_URL="mongodb://localhost:27017"     # or your Atlas SRV string
DB_NAME="app"
JWT_SECRET=<paste output of: openssl rand -hex 32>
APP_MASTER_KEY=<paste output of: openssl rand -hex 32>
```

> `APP_MASTER_KEY` encrypts the provider keys stored in the database. Changing it later
> makes existing stored keys undecryptable, so set it once and keep it.

**To make the AI pipeline actually run**, also add a Gemini key — free from
[aistudio.google.com/apikey](https://aistudio.google.com/apikey):

```ini
SEED_GEMINI_API_KEY=AIza...
```

Optional, for the retrieval comparison page:

```ini
SEED_QDRANT_API_KEY=...        # free cluster at https://cloud.qdrant.io
SEED_QDRANT_URL=https://xxxx.aws.cloud.qdrant.io:6333
SEED_PAGEINDEX_API_KEY=...     # https://dash.pageindex.ai
```

Without any provider key the app still runs end to end — queries return
`INSUFFICIENT_INFO` with a "no AI credential configured" stage, which is the designed
fallback rather than a crash.

### 4. Install and run the backend

```bash
# from the backend/ directory
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python seed.py                      # creates demo tenants, employees, policies, keys
uvicorn server:app --reload --port 8001
```

`seed.py` is idempotent — safe to re-run. It prints the demo logins and which providers it
seeded.

### 5. Install and run the frontend

In a second terminal:

```bash
cd frontend
yarn install
yarn dev
```

Open **http://localhost:3000** and sign in with any account from the table above
(`gauri.khedekar.entc.2023@vpkbiet.org` / `admin123`).

Vite proxies `/api` → `localhost:8001`, so no frontend env var is needed.

### Verify it works

```bash
curl http://localhost:8001/api/              # {"message":"...","status":"ok"}
cd backend  && python -m pytest              # 9 guardrail tests
cd frontend && yarn typecheck                # 0 errors
```

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `pymongo.errors.ServerSelectionTimeoutError` | MongoDB isn't running or `MONGO_URL` is wrong |
| Login returns 401 with the demo credentials | `python seed.py` wasn't run, or it ran against a different `DB_NAME` |
| Login succeeds but immediately bounces to `/login` | Session cookie rejected. Use `http://localhost:3000` (not `127.0.0.1`) so the cookie's origin matches |
| Queries return `INSUFFICIENT_INFO`, trace shows "No Gemini credential" | No `SEED_GEMINI_API_KEY` set — add it and re-run `python seed.py` |
| Trace stage `failed` with HTTP 429 | Gemini free tier is 20 requests/model/day. Wait, or enable billing |
| `bcrypt` / `passlib` AttributeError on startup | bcrypt 4.1+ broke passlib 1.7.4. Keep the `bcrypt==4.0.1` pin |
| Port already in use | `uvicorn ... --port 8002` and update `frontend/vite.config.ts`'s proxy target |

> **Hosted pod only:** all three services run under supervisor —
> `sudo supervisorctl restart backend frontend`, logs in
> `/var/log/supervisor/{backend,frontend}.err.log`.

## Configuration reference

Copy the template and fill it in — the real file is gitignored and must never be committed:

```bash
cp backend/.env.example backend/.env
```

`backend/.env`:

```ini
MONGO_URL=mongodb://localhost:27017
DB_NAME=app
CORS_ORIGINS=*                      # dev only; in production must be explicit HTTPS origins
ENV=development                     # set to `production` on a real deployment
COOKIE_SECURE=false                 # dev over HTTP; forced true when ENV=production
JWT_SECRET=<random secret>          # session signing
APP_MASTER_KEY=<random secret>      # derives the Fernet key for provider secrets
GEMINI_MODELS=gemini-3-flash-preview,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.6-flash
GEMINI_EMBED_MODEL=gemini-embedding-001
RESEND_API_KEY=                     # optional; empty → invite links shown in the UI
SENDER_EMAIL=onboarding@resend.dev
```

> **Production hardening.** When `ENV=production`, startup **hard-fails** (not just warns)
> if `JWT_SECRET`/`APP_MASTER_KEY` are placeholder/weak or if `CORS_ORIGINS` is `*`/empty,
> and session cookies are forced to `Secure; SameSite=None; HttpOnly`. The frontend reads
> `VITE_API_BASE_URL` (build-time) for cross-origin deployments and falls back to the Vite
> `/api` proxy locally. Full deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Provider keys (Gemini / Qdrant / PageIndex) are **not** env vars — they are per-tenant,
added in-app at **API & AI Backends** (`/company/api-keys`) and stored encrypted. That page
now shows a **"Which keys should I add?"** guide inline. In short:

| Provider | Required? | Purpose | Get a key |
|---|---|---|---|
| **Google Gemini** | **Required** | Powers the whole agent — input guardrail, retrieval reasoning, decision, output check. Without it every question returns "no AI credential configured". | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Qdrant** | Optional | Vector search for policies tagged *Qdrant*. Needs a **Cluster URL + API key**. | [cloud.qdrant.io](https://cloud.qdrant.io) |
| **PageIndex** | Optional | Structure-aware retrieval for policies tagged *PageIndex*. | [dash.pageindex.ai](https://dash.pageindex.ai) |

> Add the Gemini key first to switch the assistant on; the other two only change how policy
> text is retrieved. Keys are encrypted on save and never shown again — only the last four
> characters are displayed.

> `APP_MASTER_KEY` is the encryption root. Rotating it makes existing stored provider
> keys undecryptable — they must be re-entered.

## Testing

```bash
cd backend && python -m pytest              # guardrail unit tests (pytest-xdist)
cd frontend && yarn typecheck               # TS strict, catches Pydantic↔TS drift
bash scripts/adversarial.sh <email> <pw> "<query>"   # adversarial guardrail probes
```

Results, adversarial traces and benchmark numbers: [`docs/TESTING.md`](docs/TESTING.md)

## Documentation

| Doc | Contents |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **Deploy off-Emergent on free tiers:** Render (backend) + Vercel (frontend) + MongoDB Atlas, env-var reference, cross-origin cookie setup, post-deploy verification checklist |
| [`docs/ADOPTION_GUIDE.md`](docs/ADOPTION_GUIDE.md) | **For a company adopting this:** rollout plan, writing policies the agent can use, running the weekly review, security-review answers, costs, limits |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Design decisions, data model, request flow, file-by-file map |
| [`docs/TESTING.md`](docs/TESTING.md) | Unit/browser results, all adversarial guardrail traces |
| [`docs/RETRIEVAL_BENCHMARK.md`](docs/RETRIEVAL_BENCHMARK.md) | Qdrant vs PageIndex: speed, accuracy, divergence analysis |
| [`docs/INTERVIEW_QA.md`](docs/INTERVIEW_QA.md) | ~40 likely interview questions with answers |
| [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md) | Annotated screenshot walkthrough |

## Known limits

- **Gemini free tier is 20 requests per model per day.** A query costs ~6, so the model
  fallback chain yields ~13 queries/day. Enable billing to remove the cap.
- **PageIndex cloud API is not called.** Its SDK ingests PDFs while policies here are
  Markdown, so that backend runs local heading-tree reasoning instead. Swapping in the
  HTTP client is isolated to `pageindex_retrieve()`.
- Email invites need a Resend key; without one the invite link is shown in the admin UI.
- Run traces are unbounded — a retention policy would be needed at scale.
