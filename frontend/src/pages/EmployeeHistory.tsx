import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock } from "lucide-react";
import AppShell from "@/components/AppShell";
import DecisionBadge from "@/components/DecisionBadge";
import EmptyState from "@/components/EmptyState";
import RunTrace from "@/components/RunTrace";
import { apiGet } from "@/lib/api";
import type { Me, Run } from "@/lib/types";

export default function EmployeeHistory({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [openId, setOpenId] = useState<string | null>(null);
  const runs = useQuery<Run[]>({
    queryKey: ["employee", "runs"],
    queryFn: () => apiGet<Run[]>("/employee/runs"),
  });
  const list = runs.isError ? [] : (runs.data ?? []);

  return (
    <AppShell
      me={me}
      title="My Requests"
      subtitle="Every question you have asked, its decision, and the full reasoning trace behind it."
    >
      {list.length === 0 ? (
        <EmptyState
          testId="employee-runs-empty-state"
          icon={<Clock className="size-5" />}
          title="You haven't asked anything yet"
          description="Submit a policy question from the Compliance Assistant and it will appear here with its decision and evidence."
          actionLabel="Ask a question"
          onAction={() => navigate("/employee/home")}
        />
      ) : (
        <div className="space-y-3" data-testid="employee-runs-list">
          {list.map((r) => {
            const open = openId === r.id;
            return (
              <div
                key={r.id}
                data-testid={`employee-run-${r.id}`}
                className="rounded-lg border border-[#1e2433] bg-[#11141d] transition-all duration-200 hover:border-[#2d374d]"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.id)}
                  data-testid={`employee-run-toggle-${r.id}`}
                  className="w-full p-5 text-left"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-2xl text-sm text-zinc-200">{r.query}</p>
                    <div className="flex items-center gap-2">
                      <DecisionBadge decision={r.decision} testId={`employee-run-badge-${r.id}`} />
                      <ChevronDown
                        className={`size-3.5 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                      />
                    </div>
                  </div>
                  {r.answer ? (
                    <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {r.answer}
                    </p>
                  ) : null}
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                    {new Date(r.created_at).toLocaleString()}
                    {r.latency_ms ? ` · ${r.latency_ms}ms` : ""}
                  </p>
                </button>
                {open ? (
                  <div className="border-t border-[#1c2230] p-5">
                    <RunTrace
                      trace={r.trace}
                      citedEvidence={r.cited_evidence}
                      reasoning={r.reasoning}
                      latencyMs={r.latency_ms}
                      idPrefix={`employee-run-${r.id}`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
