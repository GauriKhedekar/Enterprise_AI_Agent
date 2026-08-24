#!/usr/bin/env bash
# Submit a query as an employee, poll until the background pipeline completes, print the trace.
set -u
B=https://enterprise-agent-3.preview.emergentagent.com
EMAIL="$1"; PASS="$2"; Q="$3"
J=$(mktemp)
curl -s -c "$J" -o /dev/null -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
RID=$(curl -s -b "$J" -X POST $B/api/employee/runs -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$Q")" \
  | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
echo "run id: $RID"
for i in $(seq 60); do
  curl -s -b "$J" "$B/api/employee/runs/$RID" -o /tmp/run.json
  ST=$(python -c 'import json;print(json.load(open("/tmp/run.json"))["status"])' 2>/dev/null || echo running)
  [ "$ST" = "complete" ] && break
  sleep 3
done
python - <<'PY'
import json
d=json.load(open('/tmp/run.json'))
print("query    :", d["query"])
print("status   :", d["status"], "| decision:", d.get("decision"), "| latency:", d.get("latency_ms"), "ms")
print("answer   :", (d.get("answer") or "")[:300])
print("flags    : policy=%s data=%s action=%s action_taken=%s tool=%s" % (
  d.get("policy_required"), d.get("enterprise_data_required"),
  d.get("action_required"), d.get("action_taken"), d.get("tool_called")))
print("citations:", len(d.get("cited_evidence") or []))
for c in (d.get("cited_evidence") or []):
    print("   -", c["source"], "|", c["text"][:100])
print("--- stages ---")
for s in d.get("trace") or []:
    print(f"  {s['name']:26} {s['status']:8} {s['latency_ms']:>6}ms  {s['summary'][:100]}")
PY
