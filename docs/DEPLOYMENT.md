# Deployment — Render + Vercel + MongoDB Atlas (free tier)

This is the turnkey path to run the app **fully independently of Emergent's preview**:
backend on **Render**, frontend on **Vercel**, database on **MongoDB Atlas**. Nothing here
depends on Emergent staying live once deployed.

- [Overview](#overview)
- [1. MongoDB Atlas (database)](#1-mongodb-atlas-database)
- [2. Render (backend)](#2-render-backend)
- [3. Vercel (frontend)](#3-vercel-frontend)
- [4. Seed vs fresh start](#4-seed-vs-fresh-start)
- [5. Post-deploy verification checklist](#5-post-deploy-verification-checklist)
- [Environment variable reference](#environment-variable-reference)
- [Troubleshooting](#troubleshooting)

---

## Overview

```
  Browser ──HTTPS──▶ Vercel (static React build)
                        │  fetch(VITE_API_BASE_URL, credentials:"include")
                        ▼
                     Render (FastAPI, uvicorn)  ──▶  MongoDB Atlas (M0)
                        │
                        └─▶ Gemini / Qdrant (per-tenant keys, added in-app)
```

Two origins (Vercel + Render) means auth cookies are **cross-origin**, so three things must
line up and are already wired in the code:

- The frontend sends `credentials: "include"` on every request (`frontend/src/lib/api.ts`).
- The backend sets the session cookie `Secure; SameSite=None; HttpOnly` when `ENV=production`
  (`backend/routers/auth.py::_set_session`).
- The backend's `CORS_ORIGINS` must be the **exact** Vercel URL (a wildcard `*` is rejected
  at startup in production — see `server.py::_validate_production_config`).

Deploy order: **Atlas → Render → Vercel** (each needs the previous one's URL).

---

## 1. MongoDB Atlas (database)

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a database user (username + password). Save the password.
3. **Network Access** → add IP `0.0.0.0/0` (Render's egress IPs are dynamic on the free
   plan; restrict later if you move to a paid plan with static egress).
4. **Connect → Drivers** → copy the SRV connection string. It looks like:
   ```
   mongodb+srv://<user>:<password>@<cluster>.xxxx.mongodb.net/?retryWrites=true&w=majority
   ```
   URL-encode any special characters in the password. This is your `MONGO_URL`.

> A Windows-only local TLS handshake issue against Atlas was seen in development. It does
> **not** reproduce on Render's Linux containers — but confirm the backend actually
> connects (step 5) rather than assuming.

---

## 2. Render (backend)

The repo ships [`render.yaml`](../render.yaml) as a Blueprint, so most of this is filled in.

1. Render dashboard → **New → Blueprint** → connect this GitHub repo. Render reads
   `render.yaml` and provisions a free Web Service with:
   - **Root directory:** `backend`
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Health check path:** `/api/`
2. In the service's **Environment** tab, set the values marked `sync: false` in the blueprint
   (they are intentionally not in git):
   - `MONGO_URL` — the Atlas SRV string from step 1.
   - `CORS_ORIGINS` — your Vercel URL (you'll get it in step 3; set a placeholder now and
     update after Vercel is live), e.g. `https://your-app.vercel.app`. Comma-separate if you
     have more than one origin. **No wildcard.**
   - `APP_MASTER_KEY` — `openssl rand -hex 32`. **Set once and never change it** — it
     encrypts stored provider keys; rotating it makes existing keys undecryptable.
   - `JWT_SECRET` — the blueprint sets `generateValue: true`, so Render generates a strong
     one automatically. (Override with your own `openssl rand -hex 32` if you prefer.)
   - Optional: `RESEND_API_KEY` (invite/notification emails), and the `SEED_*` provider keys
     if you plan to run the demo seed.
   - `ENV=production`, `DB_NAME`, `GEMINI_MODELS`, `GEMINI_EMBED_MODEL`, `SENDER_EMAIL` are
     already set as non-secret values in the blueprint.
3. Deploy. When the health check at `https://<your-backend>.onrender.com/api/` returns
   `{"message":"Adaptive Enterprise Agent API","status":"ok"}`, the backend is up.

> **Free-plan cold starts:** Render free web services sleep after ~15 min idle and take
> ~30–60s to wake. The first request after idle is slow; this is expected on the free tier.

---

## 3. Vercel (frontend)

The repo ships [`frontend/vercel.json`](../frontend/vercel.json) (Vite framework, SPA
rewrite so deep links like `/company/employees` resolve to `index.html`).

1. Vercel dashboard → **Add New → Project** → import this repo.
2. **Root Directory:** `frontend`. Vercel auto-detects Vite; `vercel.json` supplies the
   build (`yarn build`) and output (`dist`) settings.
3. **Environment Variables** → add:
   - `VITE_API_BASE_URL` = `https://<your-backend>.onrender.com/api`  ← include the `/api`
     suffix. Vite reads `VITE_*` at **build time**, so set this *before* the first build.
4. Deploy. Note the resulting URL (e.g. `https://your-app.vercel.app`).
5. **Go back to Render** and set `CORS_ORIGINS` to exactly that Vercel URL, then redeploy
   the backend (or trigger a restart) so CORS allows the frontend origin.

> If you change the Vercel URL or backend URL later, update `VITE_API_BASE_URL` (Vercel,
> then redeploy) and `CORS_ORIGINS` (Render, then restart) together.

---

## 4. Seed vs fresh start

**Chosen for this project: start from a fresh company signup in production — do NOT run the
demo seed against the production database.** Reasons:

- The demo seed's provider keys come from `SEED_*` env vars and are meant for evaluation,
  not a real tenant.
- Real usage begins by visiting `/signup`, which creates the company and its first admin in
  one step, then adding employees, policies and a Gemini key in-app.

If you *do* want the demo tenants in a non-production/staging database, set the `SEED_*`
vars on Render, open a shell on the service, and run `cd backend && python seed.py` (it is
idempotent). Never point it at a database holding real employee data.

---

## 5. Post-deploy verification checklist

Run these against the **live HTTPS** URLs, not localhost:

- [ ] `curl https://<backend>.onrender.com/api/` → `{"...","status":"ok"}`
- [ ] Frontend loads over HTTPS at the Vercel URL; no console CORS errors.
- [ ] **All three role logins work cross-origin** (admin, HR, employee) — after login,
      `GET /api/auth/me` succeeds and the session cookie persists on reload (proves
      `Secure; SameSite=None` + `credentials:"include"` are correct).
- [ ] Admin can add an employee (incl. the **employment type** select) and it appears in the
      table with its Type.
- [ ] With a Gemini key configured in-app, a full pipeline run completes end-to-end and the
      stage trace renders.
- [ ] The **HR approval** flow works: an ALLOW WFH request creates a pending `action_request`,
      and HR approve/reject resolves it.
- [ ] The **Backend Compare** page runs and returns per-backend results.
- [ ] Deep-linking directly to `https://<vercel>/company/employees` loads (SPA rewrite works)
      rather than 404.
- [ ] Wrong-origin CORS is rejected: a request from an origin **not** in `CORS_ORIGINS` is
      blocked by the browser.

---

## Environment variable reference

Set on **Render** (backend). Never commit real values — `backend/.env` is gitignored and
`backend/.env.example` holds only placeholders.

| Var | Secret? | Example / value | Notes |
|---|---|---|---|
| `ENV` | no | `production` | Enables the production config guard + secure cookies |
| `MONGO_URL` | **yes** | `mongodb+srv://…` | Atlas SRV connection string |
| `DB_NAME` | no | `app` | |
| `CORS_ORIGINS` | **yes-ish** | `https://your-app.vercel.app` | Exact Vercel origin(s), comma-separated; **no `*`** |
| `JWT_SECRET` | **yes** | `openssl rand -hex 32` | Blueprint auto-generates one |
| `APP_MASTER_KEY` | **yes** | `openssl rand -hex 32` | Encrypts stored provider keys; **never rotate** |
| `GEMINI_MODELS` | no | `gemini-3-flash-preview,…` | Ordered fallback chain |
| `GEMINI_EMBED_MODEL` | no | `gemini-embedding-001` | |
| `RESEND_API_KEY` | **yes** | (optional) | Empty → invite/notification emails degrade to log-only |
| `SENDER_EMAIL` | no | `onboarding@resend.dev` | |
| `SEED_GEMINI_API_KEY` etc. | **yes** | (optional) | Only if seeding a non-prod DB |

Set on **Vercel** (frontend):

| Var | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<backend>.onrender.com/api` | Build-time; include `/api`. Unset locally → falls back to the Vite `/api` proxy |

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Login succeeds but reloading logs you out | Cookie not persisted cross-origin. Confirm `ENV=production` on Render (forces `Secure; SameSite=None`) and that the frontend calls the HTTPS Render URL |
| Browser console: CORS error | `CORS_ORIGINS` on Render doesn't exactly match the Vercel origin (scheme + host, no trailing slash). Update and restart the backend |
| Backend won't start; log says `CORS_ORIGINS must be an explicit list` | `CORS_ORIGINS` is `*` or empty while `ENV=production`. Set an explicit origin |
| Backend won't start; log says `JWT_SECRET`/`APP_MASTER_KEY` must be strong | A placeholder secret in production. Set real random values |
| API calls 404 on Vercel deep links | SPA rewrite missing — ensure `frontend/vercel.json` is present and Root Directory is `frontend` |
| First request after idle is very slow | Render free-tier cold start (~30–60s). Expected; upgrade the plan to remove it |
| `pymongo … ServerSelectionTimeoutError` | Atlas Network Access doesn't allow Render's IP — add `0.0.0.0/0`, or the `MONGO_URL` password isn't URL-encoded |
