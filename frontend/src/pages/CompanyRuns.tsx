import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronDown } from "lucide-react";
import AppShell from "@/components/AppShell";
import DecisionBadge from "@/components/DecisionBadge";
import EmptyState from "@/components/EmptyState";
import RunTrace from "@/components/RunTrace";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { Decision, Me, PaginatedRuns } from "@/lib/types";

const FILTERS: { value: string; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ALLOW", label: "Allowed" },
  { value: "DENY", label: "Denied" },
  { value: "NOT_ELIGIBLE", label: "Not eligible" },
  { value: "INSUFFICIENT_INFO", label: "Insufficient info" },
  { value: "BLOCKED", label: "Blocked" },
];

export default function CompanyRuns({ me }: { me: Me }) {
  const [decision, setDecision] = useState("ALL");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const runs = useQuery<PaginatedRuns>({
    queryKey: ["company", "runs", decision, page],
    queryFn: () =>
      apiGet<PaginatedRuns>(`/company/runs?page=${page}&page_size=10&decision=${decision}`),
  });

  const data = runs.isError ? undefined : runs.data;
  const items = data?.items ?? [];
  const counts = data?.decision_counts ?? {};

  return (
    <AppShell
      me={me}
      title="Agent Run Log"
      subtitle="Every policy query your employees have submitted, with the decision and the full pipeline trace behind it."
    >
      <div className="mb-5 flex flex-wrap gap-2" data-testid="runs-filter-bar">
        {FILTERS.map((f) => {
          const active = decision === f.value;
          const count = f.value === "ALL" ? data?.total : counts[f.value];
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setDecision(f.value);
                setPage(1);
                setOpenId(null);
              }}
              data-testid={`runs-filter-${f.value}`}
              className={
                "rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-150 " +
                (active
                  ? "border-primary bg-[#4f46e526] text-white"
                  : "border-[#1f2636] text-zinc-400 hover:border-[#2d374d] hover:text-zinc-100")
              }
            >
              {f.label}
              {count !== undefined ? (
                <span className="ml-1.5 font-mono text-[10px] text-zinc-500">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState
          testId="company-runs-empty-state"
          icon={<Activity className="size-5" />}
          title="No policy queries match this filter"
          description="When employees ask policy questions or check WFH eligibility, each run appears here with its decision, citations, and stage-by-stage trace."
        />
      ) : (
        <>
          <div className="space-y-3" data-testid="company-runs-list">
            {items.map((r) => {
              const open = openId === r.id;
              return (
                <div
                  key={r.id}
                  data-testid={`company-run-${r.id}`}
                  className="rounded-lg border border-[#1e2433] bg-[#11141d] transition-all duration-200 hover:border-[#2d374d]"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : r.id)}
                    data-testid={`company-run-toggle-${r.id}`}
                    className="w-full p-5 text-left"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="max-w-2xl text-sm text-zinc-200">{r.query}</p>
                        <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                          <span className="text-[#c7d2fe]">{r.employee_code ?? "—"}</span>
                          <span>{r.employee_name ?? "unknown"}</span>
                          <span>{new Date(r.created_at).toLocaleString()}</span>
                          {r.latency_ms ? <span>{r.latency_ms}ms</span> : null}
                          {r.action_taken ? (
                            <span className="text-[#34d399]">action · {r.tool_called}</span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <DecisionBadge decision={r.decision as Decision | null} testId={`company-run-badge-${r.id}`} />
                        <ChevronDown
                          className={`size-3.5 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>
                  </button>
                  {open ? (
                    <div className="border-t border-[#1c2230] p-5">
                      <RunTrace
                        trace={r.trace}
                        citedEvidence={r.cited_evidence}
                        reasoning={r.reasoning}
                        latencyMs={r.latency_ms}
                        idPrefix={`company-run-${r.id}`}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Page {data?.page ?? 1} of {data?.pages ?? 1} · {data?.total ?? 0} run(s)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={(data?.page ?? 1) <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                data-testid="runs-prev-page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(data?.page ?? 1) >= (data?.pages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
                data-testid="runs-next-page"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
