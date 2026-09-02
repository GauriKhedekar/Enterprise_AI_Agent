# Adoption guide — how a company uses this

A practical, non-engineer-facing walkthrough: what the product does for a business, how to
roll it out, who does what, and the questions a security or compliance reviewer will ask.

- [Who this is for](#who-this-is-for)
- [The problem it solves](#the-problem-it-solves)
- [Day 1: getting your workspace running](#day-1-getting-your-workspace-running)
- [Writing policies the agent can actually use](#writing-policies-the-agent-can-actually-use)
- [Rolling out to employees](#rolling-out-to-employees)
- [Day-to-day operation](#day-to-day-operation)
- [Understanding the five decisions](#understanding-the-five-decisions)
- [Security & compliance review](#security--compliance-review)
- [What it costs](#what-it-costs)
- [Deployment options](#deployment-options)
- [Suggested 4-week rollout](#suggested-4-week-rollout)
- [Limits you should know before buying in](#limits-you-should-know-before-buying-in)

---

## Who this is for

| Role | What they do here |
|---|---|
| **HR / People Ops lead** | Owns the policy documents and reviews decisions in the run log |
| **Company admin** (often the same person) | Adds employees, uploads policies, holds the AI provider keys |
| **IT / Security** | Reviews the security model, provisions credentials, chooses hosting |
| **Employees** | Ask policy questions and get a cited answer |

You do **not** need a data team or an ML engineer. You need one person who owns the policy
documents and one who can paste an API key.

---

## The problem it solves

HR teams answer the same policy questions hundreds of times a month — *"how many WFH days
do I get?"*, *"can I take leave during probation?"*, *"do I qualify yet?"*. Each answer
depends on two things: what the policy says, and the employee's own record (tenure,
department, status).

Three things typically go wrong:

1. **It doesn't scale.** Every question costs an HR person's time.
2. **Answers drift.** Two HR staff give different answers to the same question.
3. **Nothing is auditable.** Six months later nobody can explain why an employee was told
   they were eligible.

This tool answers the question automatically, applies the policy consistently against the
employee's actual record, and keeps a permanent, inspectable record of *why* each answer
was given — including the exact policy clause it relied on.

**What it deliberately does not do:** it does not replace HR judgement. It answers
policy-and-record questions and logs them. Exceptions, appeals and anything requiring
discretion still go to a human — and because every decision carries its reasoning, a human
reviewing an appeal starts with the full context.

---

## Day 1: getting your workspace running

### Step 1 — Create the company workspace (5 min)

Go to `/signup`, enter your company name, work email and a password. This creates an
isolated tenant and makes you its first **company admin**. Nothing is shared with any other
company using the platform.

### Step 2 — Add your AI provider key (5 min)

The system uses *your* AI credentials, not a shared pool — so your policy content and
employee data go to your own provider account under your own terms. Open **API & AI
Backends**; it shows a **"Which keys should I add?"** guide inline. The short version:

| Provider | Required? | What it does | Where to get it |
|---|---|---|---|
| **Google Gemini** | **Required** | Runs the entire agent (guardrail, retrieval reasoning, decision, output check). Without it, every question returns "no AI credential configured". | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Qdrant** | Optional | Vector search for policies you tag *Qdrant*; needs a **Cluster URL + API key**. | [cloud.qdrant.io](https://cloud.qdrant.io) |
| **PageIndex** | Optional | Structure-aware retrieval for policies you tag *PageIndex*. | [dash.pageindex.ai](https://dash.pageindex.ai) |

1. Get a Google Gemini API key (link above) — this is the only one you *need* to go live.
2. In the app: **API & AI Backends → Configure API key → provider: Google Gemini**, paste it, label it.
3. Optionally add **Qdrant** (paste the Cluster URL + key) and/or **PageIndex** later if you
   want to compare retrieval backends.

The key is encrypted immediately. **It is never shown again** — not even to you. The list
only ever displays the last 4 characters. If you lose it, you rotate it rather than read it
back. That is deliberate: a system that can show you the key can leak the key.

### Step 3 — Load your employee directory (15 min)

**Employees → Add employee**: name, work email, department, joining date, status. Each gets
an auto-assigned employee code (`EMP-0001`…).

The **joining date is the important field** — tenure is recalculated from it server-side on
every query, so rules like "after 6 months of service" stay correct forever without anyone
maintaining a spreadsheet.

> At scale you'd want an HRIS sync (Workday/BambooHR/Personio) instead of manual entry.
> That integration doesn't exist yet — see [Limits](#limits-you-should-know-before-buying-in).

### Step 4 — Upload your policies (30 min)

**Policies & GRC → Create policy**: paste the policy as Markdown, pick a retrieval backend.
See the next section — this step determines answer quality more than anything else.

---

## Writing policies the agent can actually use

This is the highest-leverage thing you control. The agent can only cite what it can find.

**Use real headings.** Retrieval works over your heading structure, and citations quote the
heading path — so `"WFH Policy > 2. Minimum Service Requirement"` appears in the audit
trail. A wall of unstructured text produces vague citations.

**One rule per section.** If a section contains both the general allowance *and* the tenure
exception, retrieval can't separate them and the agent may cite the wrong half.

**State conditions in plain, explicit terms.** Write *"a minimum of six (6) months of
continuous service"*, not *"following the standard qualifying period"*. The agent reasons
over the words present; an undefined cross-reference is a gap it will honestly report as
`INSUFFICIENT_INFO`.

**Say what happens when rules conflict.** If medical accommodation overrides the tenure
minimum, write that down. Otherwise two clauses point in opposite directions.

**Good structure looks like this:**

```markdown
# Work From Home Policy

## 1. General Allowance
Full-time employees may work from home up to **two (2) days per calendar week**,
subject to manager approval.

## 2. Minimum Service Requirement
Eligibility begins only after **six (6) months of continuous service**. Employees
with fewer than six months, including those on probation, are not eligible.

## 3. Exceptions
Medical accommodations and company-declared closures override clauses 1 and 2,
subject to People Ops confirmation.
```

> **Two conditions in the example above are enforced in code, not just read by the model:**
> the **weekly cap** ("two days per calendar week") is counted across an employee's already
> approved *and* pending requests for that week — a request that would exceed it is denied
> even if it looks fine on its own — and **"full-time employees"** is checked against each
> employee's `employment_type`, so a long-tenure contractor is correctly found ineligible on
> that clause. Write these conditions explicitly and they become genuinely checkable.

**Who approves.** State-changing actions (like a WFH request) wait for a human. From
**Team & HR** you invite **HR reviewers** and **managers**. If an employee has a manager set
(their `manager_employee_code`) and that manager has a login, the request goes to the
**manager first**, then to **HR** for final sign-off — a manager-then-HR chain. Employees
with no manager go straight to HR. Turn on real email notifications by setting
`RESEND_API_KEY`; without it, notifications are logged instead of sent.

**Which retrieval backend to tag?** Short, well-structured documents like the above →
**PageIndex** (more precise, cites clause paths cleanly). Large or messy document sets →
**Qdrant**. Unsure? Tag a few each way and use the **Backend Compare** page to see which
gives better answers on your real questions — that page exists precisely for this decision.

---

## Rolling out to employees

Employees **cannot self-register** — that's a deliberate control, so only people in your
directory get access.

From **Employees**, click **Invite** on a row. The employee receives a single-use link (or
you copy it from the dialog if email isn't configured) where they set their own password.
The link stops working once used.

**Start with a pilot.** Pick 10–20 people in one department, with one clearly-written
policy loaded. Watch the run log for a week before widening. You will learn more from 50
real questions than from any amount of planning — mostly about which policy wording is
ambiguous.

**What to tell employees:** it answers questions about company policy using the published
documents and their own HR record; it shows exactly which clause it used; it is not a
decision-maker for exceptions; and every question is logged and visible to HR. That last
point matters — say it up front rather than letting someone discover it.

---

## Day-to-day operation

### For employees
Go to **Compliance Assistant**, type the question, submit. The pipeline runs for roughly
7–25 seconds with visible progress, then returns a colour-coded decision, a plain-language
answer, and an expandable **"How this was decided"** panel showing every stage and the
policy clauses used. **My Requests** keeps their history.

### For HR / admins
**Agent Run Log** is your operational view: every question from every employee, filterable
by outcome, each row expanding to the full reasoning trace.

**A weekly 15-minute review is the habit worth building:**

| Look for | What it usually means | Action |
|---|---|---|
| Repeated `INSUFFICIENT_INFO` on similar questions | A policy gap or vague wording | Rewrite that clause; add the missing rule |
| Answers citing the wrong clause | Two rules crammed into one section | Split the section |
| Many `BLOCKED` from one employee | Off-topic use, or someone probing the system | Have a conversation |
| High volume on one topic | A genuine communication gap | Address it in onboarding or an all-hands |
| Any decision that looks wrong | Ambiguous policy, or a retrieval miss | Open the trace — it shows which of the two it was |

That last row is the point of the product. When an answer is wrong you can tell *why*
within seconds: either retrieval fetched the wrong clause, or the clause itself was
ambiguous. Both are fixable, and both are invisible in a system without a trace.

---

## Understanding the five decisions

| Badge | Meaning | What HR should do |
|---|---|---|
| **ALLOW** (green) | Policy permits it and the employee meets every condition | Nothing — cited and logged |
| **DENY** (red) | The policy prohibits it outright | Nothing, unless the employee appeals |
| **NOT ELIGIBLE** (amber) | Permitted in general, but this employee fails a condition (e.g. tenure) | Nothing — but note the date they *do* qualify |
| **INSUFFICIENT INFO** (grey) | The published policies can't settle the question | **Act on these** — each one is a policy gap |
| **BLOCKED** (purple) | The question was off-topic, or an attempt to misuse the system | Review if repeated from one person |

`DENY` vs `NOT ELIGIBLE` is a distinction worth understanding: "the policy forbids this"
and "you don't qualify yet" need different responses to the employee.

---

## Security & compliance review

The questions a security reviewer will ask, and the honest answers:

**"Can another company see our data?"**
No. Every database query is filtered by your company ID, taken from the signed session
token — not from anything the browser can set. This is enforced on every single API
endpoint, including direct lookups by ID: requesting another tenant's record by guessing
its ID returns "not found", never their data. It's verified by automated tests on every
change, using a second tenant that must see zero of the first tenant's records.

**"Where does our policy text go?"**
To the AI provider whose key *you* supplied (Google Gemini), under your account and their
terms. There is no shared or vendor-owned model in the path, and nothing is used to train
anything. Policy text and the minimum necessary employee fields are sent per query.

**"What employee data is exposed?"**
For the person asking: their own code, name, department, tenure, status. If a question
references a *colleague*, the system deliberately narrows this to code, department, tenure
and status — **no name, no email, no joining date** — and a final code-level check scans
the answer for any other employee's name or email and replaces it with a refusal if found.
Direct requests for a colleague's personal details are rejected outright before any
database lookup.

**"Can the AI approve something it shouldn't?"**
No action is ever taken on the model's word alone. Executing an action requires all of:
the decision is ALLOW, the request genuinely asked for an action, *and* code has verified
the referenced employee actually exists in the retrieved data. A model that invents an
employee gets its action refused and the attempt flagged in the log. Separately, every
citation is checked against the actually-retrieved policy text and silently-invented
citations are stripped and recorded.

**"Who can see the audit log?"**
Company admins see all runs for their company. Employees see only their own.

**"Where is data stored, and can we host it ourselves?"**
MongoDB, wherever you deploy it — your own infrastructure, your own cloud, or a managed
cluster in your region. Nothing is architecturally tied to a specific host.

**"Is it GDPR-ready?"**
Partly, and here's the gap: data minimisation, purpose limitation and full audit trails are
in place, and self-hosting lets you keep data in-region. **Not yet built:** a
right-to-erasure workflow (deleting an employee doesn't purge their historical run traces),
formal retention/expiry policies, and a data-processing agreement with your AI provider —
that last one is between you and Google. Treat this as pilot-ready, and close those gaps
before production use with real employee data.

---

## What it costs

Three components:

**1. AI usage — the only per-query cost.** Each question makes up to 6 model calls; a
blocked or off-topic question costs 1. On Gemini's paid tier this is fractions of a cent
per question, so a 500-employee company asking a few thousand questions a month is a small
bill. **The free tier is capped at 20 requests per model per day**, which is fine for
evaluation and nowhere near enough for production — budget for enabling billing on your
Google Cloud project before rollout.

**2. Hosting.** A small VM plus a managed MongoDB cluster. Modest and fixed.

**3. Optional services.** Qdrant Cloud has a free tier that covers small policy sets; email
delivery for invites is effectively free at this volume.

**Cost control worth knowing:** repeated identical questions are common in HR, so response
caching would cut AI spend materially. It isn't implemented yet — see Limits.

---

## Deployment options

| Option | Fit | Notes |
|---|---|---|
| **Free-tier, self-hosted** | Fastest independent deploy | Render (backend) + Vercel (frontend) + MongoDB Atlas — step-by-step in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) |
| **Managed / hosted** | Quick evaluation | Development preview link in the README |
| **Your own cloud** (AWS/GCP/Azure) | Most companies | Container + managed MongoDB (Atlas) in your region |
| **Fully on-premise** | Strict data-residency rules | Works, but the AI provider call still leaves your network unless you use a private model endpoint |

Setup instructions are in the [README](../README.md#running-locally) and, for a live
free-tier deployment independent of any single host, [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
Anyone who can deploy a Python API and a static frontend can stand it up.

---

## Suggested 4-week rollout

| Week | Focus | Done when |
|---|---|---|
| **1** | Workspace, AI key, one well-structured policy, 10 pilot employees | A pilot user gets a correctly-cited answer |
| **2** | Pilot in one department. Review the run log daily | You've fixed the policy wording the log exposed |
| **3** | Load remaining policies. Use **Backend Compare** to pick a retrieval backend. Invite one full department | Answers are consistently correct on your real questions |
| **4** | Company-wide invites. Hand the weekly log review to HR | HR owns the review habit without engineering help |

**The mistake to avoid:** uploading every policy and inviting everyone on day one. You'll
get a flood of `INSUFFICIENT_INFO` from clauses nobody has cleaned up yet, and employees
will decide the tool doesn't work. Policy quality is the product's quality — earn trust with
one good policy first.

---

## Limits you should know before buying in

Stated plainly, so nothing is a surprise after you commit:

- **No HRIS integration.** Employees are entered manually or via the API. No Workday/
  BambooHR sync yet, so a large directory means bulk-loading through the API.
- **7–25 seconds per answer.** Correctness and a full audit trail were prioritised over
  speed. Fine for considered policy questions; not a chat experience.
- **No response caching**, so identical questions cost full price every time.
- **English only** — untested on other languages.
- **No right-to-erasure workflow.** Deleting an employee leaves their historical run traces.
- **Background processing isn't fully durable.** A crash *inside* a question now resolves
  that run to an `error` state rather than hanging, but a hard server kill mid-question
  still leaves it stuck; the employee simply re-asks. Needs a proper job queue before high
  volume.
- **Policy versioning is absent.** Editing a policy doesn't snapshot the old version, so a
  trace cites the clause text as retrieved at the time but you can't diff policy history.
- **AI is not infallible.** The guardrails prevent fabricated citations and unauthorised
  actions, and every answer is inspectable — but keep a human in the loop for anything
  consequential, and treat the run log as a review queue rather than a receipt.
