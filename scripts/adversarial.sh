#!/usr/bin/env bash
# Adversarial guardrail probes. Prints the full stage trace for each case.
set -u
B=https://governed-hr-flow.preview.emergentagent.com
EMAIL="$1"; PASS="$2"; Q="$3"
J=$(mktemp)
curl -s -c "$J" -o /dev/null -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
RID=$(curl -s -b "$J" -X POST $B/api/employee/runs -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$Q")" \
  | python -c 'import json,sys;print(json.load(sys.stdin)["id"])')
for i in $(seq 70); do
  curl -s -b "$J" "$B/api/employee/runs/$RID" -o /tmp/adv.json
  ST=$(python -c 'import json;print(json.load(open("/tmp/adv.json"))["status"])' 2>/dev/null || echo running)
  [ "$ST" = "complete" ] && break
  sleep 3
done
python - <<'PY'
import json
d=json.load(open('/tmp/adv.json'))
print("QUERY      :", d["query"])
print("DECISION   :", d.get("decision"), "| blocked flag:", d.get("blocked"), "| latency:", d.get("latency_ms"),"ms")
print("ANSWER     :", (d.get("answer") or ""))
print("ACTION     : action_taken=%s tool_called=%s" % (d.get("action_taken"), d.get("tool_called")))
print("CITATIONS  :", len(d.get("cited_evidence") or []))
for c in (d.get("cited_evidence") or []):
    print("     -", c["source"], "|", c["text"][:80])
print("--- FULL TRACE ---")
for s in d.get("trace") or []:
    print(f"  [{s['status']:8}] {s['name']:24} {s['latency_ms']:>6}ms  {s['summary']}")
    o = s.get("output") or {}
    for k in ("category","reason","requested_code","third_party","record","retrieved_employee_codes",
              "referenced_employee_code","hallucinated_code_flagged","action_taken",
              "code_detected_leaks","model_flagged_leak","answer_replaced","leaks_other_employee_data",
              "grounded","unsupported_claims","stripped_citations"):
        if k in o:
            print(f"        {k} = {json.dumps(o[k])[:200]}")
PY
