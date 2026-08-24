# Screenshot walkthrough

All images captured against the live deployment at
`https://enterprise-agent-3.preview.emergentagent.com` (1440×900, dark theme).

## 1. Authentication

### Shared login page
![Login](screenshots/01-login.jpg)

One login page for both roles. The backend returns the user's role and the frontend routes
`company_admin` → `/company/dashboard` and `employee` → `/employee/home`. Demo credentials
are surfaced in-page for reviewers.

---

## 2. Company administrator

### Dashboard overview
![Dashboard](screenshots/02-admin-dashboard.jpg)

Tenant-scoped counts (employees, policies, keys) plus per-provider configuration status.
The sidebar shows the active tenant name — proof the session is tenant-bound.

### Employee directory
![Employees](screenshots/03-employees.jpg)

`service_months` is recomputed server-side from `joining_date` on every read, colour-coded
against the 6-month policy threshold (green ≥ 6, amber < 6). Note the mix of tenures — this
is what makes the WFH eligibility rule testable.

### Provider credentials — masked
![API keys](screenshots/04-api-keys-masked.jpg)

The secret column shows `••••••••••••` + last 4 only. The plaintext is encrypted with
Fernet on write and **never** returned by any endpoint, including to the admin who created
it. Qdrant rows also display their cluster URL. Each row supports rotate and revoke.

### Policy base
![Policies](screenshots/05-policies.jpg)

Markdown policies with a retrieval-backend tag. The Work From Home Policy contains both the
general 2-day allowance clause and the 6-month minimum-service clause — the two clauses the
agent must weigh against each other.

### Invite-only employee onboarding
![Invite](screenshots/06-employee-invite.jpg)

Employees cannot self-register. The admin generates a single-use invite link (also emailed
when Resend is configured). The link is composed from the browser's own origin.

---

## 3. Employee experience

### Live pipeline progress
![Pipeline progress](screenshots/07-pipeline-progress.jpg)

Real progress, not a fake spinner: the backend `$push`es each completed stage to Mongo and
the UI polls every 1.2s, rendering each stage's status, one-line summary and latency as it
lands. The counter (`2/9`) and the pulsing "working…" row reflect actual server state.

### Grounded decision
![Decision](screenshots/08-decision-badge.jpg)

Colour-coded decision badge (green ALLOW / red DENY / amber NOT_ELIGIBLE / grey
INSUFFICIENT_INFO / purple BLOCKED) plus the validated answer.

### "How this was decided"
![Employee trace](screenshots/09-employee-trace.jpg)

The employee — not just the admin — can inspect the reasoning: the model's rationale, every
surviving citation with its source clause path, and all nine stages with per-stage timing.
This is the trust mechanism: a denied employee can see exactly which clause denied them.

### Request history
![My requests](screenshots/16-my-requests.jpg)

Every past question with its decision, expandable to the same full trace.

---

## 4. Auditability (admin)

### Agent run log
![Run log](screenshots/10-agent-run-log.jpg)

Every query from every employee in the tenant, paginated, with filter chips per decision
outcome and live counts. Rows show the asking employee's code, timestamp, latency, and
whether an action was executed.

### Expanded trace
![Trace expanded](screenshots/11-run-trace-expanded.jpg)

The same nine-stage trace as the employee sees, plus the reasoning and cited evidence.

### Raw stage output
![Stage JSON](screenshots/12-stage-raw-json.jpg)

Any stage expands to its raw JSON — the exact structured output of that Gemini call or code
gate. This is what makes a decision defensible in an audit: you can see the classifier's
booleans, the retrieved chunks with similarity scores, stripped citations, and the tool
gate's verification of the employee code.

---

## 5. Retrieval backend comparison

### Empty state
![Compare empty](screenshots/15-compare-empty-state.jpg)

Past queries are offered as checkboxes; custom test queries can be typed in.

### Summary statistics
![Compare stats](screenshots/13-compare-stats.jpg)

Decision agreement rate, average latency per backend, and average evidence overlap.

### Divergence detail
![Compare divergence](screenshots/14-compare-divergence.jpg)

Divergent cases are highlighted amber and shown side by side: each backend's decision,
rationale, and the exact policy sections it retrieved (with similarity scores for Qdrant).
See [`RETRIEVAL_BENCHMARK.md`](RETRIEVAL_BENCHMARK.md) for the analysis.
