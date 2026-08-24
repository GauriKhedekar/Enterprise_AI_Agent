import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GitCompare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import DecisionBadge from "@/components/DecisionBadge";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { BackendResult, CompareCase, CompareResponse, Me } from "@/lib/types";

function BackendColumn({ r, testId }: { r: BackendResult; testId: string }) {
  return (
    <div className="rounded-lg border border-[#1e2433] bg-[#0e1118] p-4" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge
          variant="outline"
          className="border-[#2c3348] bg-[#4f46e526] font-mono text-[10px] uppercase text-[#c7d2fe]"
        >
          {r.backend}
        </Badge>
        <span className="font-mono text-[10px] text-zinc-600">{r.latency_ms}ms</span>
      </div>

      <div className="mt-3">
        {r.error ? (
          <p className="text-xs leading-relaxed text-[#f87171]" data-testid={`${testId}-error`}>
            {r.error}
          </p>
        ) : (
          <>
            <DecisionBadge decision={r.decision} testId={`${testId}-decision`} />
            <p className="mt-2.5 text-xs leading-relaxed text-zinc-400">{r.reasoning}</p>
          </>
        )}
      </div>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        Retrieved sections ({r.evidence.length})
      </p>
      <ul className="mt-2 space-y-1.5" data-testid={`${testId}-evidence`}>
        {r.evidence.map((e, i) => (
          <li key={i} className="border-l-2 border-[#2c3348] pl-2.5">
            <p className="font-mono text-[10px] leading-snug text-[#818cf8]">{e.source}</p>
            {e.score !== null ? (
              <span className="font-mono text-[10px] text-zinc-600">score {e.score}</span>
            ) : null}
          </li>
        ))}
        {r.evidence.length === 0 ? (
          <li className="text-xs text-zinc-600">Nothing retrieved.</li>
        ) : null}
      </ul>
    </div>
  );
}

function CaseCard({ c, index }: { c: CompareCase; index: number }) {
  return (
    <div
      data-testid={`compare-case-${index}`}
      className={
        "rounded-lg border p-5 " +
        (c.decisions_agree ? "border-[#1e2433] bg-[#11141d]" : "border-[#5f4a1f] bg-[#f59e0b0d]")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-zinc-100">{c.query}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {c.employee_code ? <span className="text-[#c7d2fe]">{c.employee_code}</span> : null}
            <span>evidence overlap {Math.round(c.evidence_overlap * 100)}%</span>
          </p>
        </div>
        <Badge
          variant="outline"
          data-testid={`compare-case-${index}-agreement`}
          className={
            "font-mono text-[10px] " +
            (c.decisions_agree
              ? "border-[#0f5f4a] bg-[#10b98122] text-[#34d399]"
              : "border-[#5f4a1f] bg-[#f59e0b22] text-[#fbbf24]")
          }
        >
          {c.decisions_agree ? "agree" : "DIVERGENT"}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <BackendColumn r={c.qdrant} testId={`compare-case-${index}-qdrant`} />
        <BackendColumn r={c.pageindex} testId={`compare-case-${index}-pageindex`} />
      </div>
    </div>
  );
}

export default function CompanyCompare({ me }: { me: Me }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<CompareResponse | null>(null);

  const suggestions = useQuery<string[]>({
    queryKey: ["company", "compare", "suggestions"],
    queryFn: () => apiGet<string[]>("/company/compare/suggestions"),
  });
  const pastQueries = suggestions.isError ? [] : (suggestions.data ?? []);

  const queries = [...selected, ...custom];

  const run = useMutation({
    mutationFn: () => apiPost<CompareResponse>("/company/compare", { queries }),
    onSuccess: (data) => {
      setResult(data);
      toast.success(`Compared ${data.stats.total} query(s) across both backends`);
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(typeof detail === "string" ? detail : "Comparison failed");
    },
  });

  const toggle = (q: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(q)) next.delete(q);
      else if (next.size + custom.length < 5) next.add(q);
      else toast.error("Up to 5 queries per comparison");
      return next;
    });
  };

  const addCustom = () => {
    const q = draft.trim();
    if (!q) return;
    if (selected.size + custom.length >= 5) {
      toast.error("Up to 5 queries per comparison");
      return;
    }
    setCustom((c) => [...c, q]);
    setDraft("");
  };

  const stats = result?.stats;
  const divergent = (result?.cases ?? []).filter((c) => !c.decisions_agree);

  return (
    <AppShell
      me={me}
      title="Retrieval Backend Comparison"
      subtitle="Run the same queries through Qdrant and PageIndex against the same policy documents, and see where evidence and decisions diverge."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Past queries
          </p>
          {pastQueries.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="compare-no-suggestions">
              No past queries yet — type a test query below.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5" data-testid="compare-suggestions">
              {pastQueries.map((q, i) => (
                <li key={q} className="flex items-start gap-2.5">
                  <Checkbox
                    id={`q-${i}`}
                    checked={selected.has(q)}
                    onCheckedChange={() => toggle(q)}
                    data-testid={`compare-select-${i}`}
                  />
                  <Label htmlFor={`q-${i}`} className="text-xs leading-relaxed text-zinc-300">
                    {q}
                  </Label>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Add a test query
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Can I work from home on Fridays?"
              data-testid="compare-custom-input"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={addCustom}
              data-testid="compare-add-custom"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          {custom.length > 0 ? (
            <ul className="mt-3 space-y-1.5" data-testid="compare-custom-list">
              {custom.map((q, i) => (
                <li
                  key={`${q}-${i}`}
                  className="flex items-start justify-between gap-2 rounded-md border border-[#1f2636] bg-[#0a0c12] px-2.5 py-1.5"
                >
                  <span className="text-xs text-zinc-300">{q}</span>
                  <button
                    type="button"
                    onClick={() => setCustom((c) => c.filter((_, j) => j !== i))}
                    data-testid={`compare-remove-custom-${i}`}
                    className="text-zinc-500 transition-colors duration-150 hover:text-[#f87171]"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Button
            className="mt-6 w-full active:scale-[0.98] transition-transform duration-100"
            disabled={queries.length === 0 || run.isPending}
            onClick={() => run.mutate()}
            data-testid="compare-run-button"
          >
            {run.isPending
              ? `Comparing ${queries.length} query(s)…`
              : `Compare ${queries.length || ""} query(s)`}
          </Button>
          <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
            Comparison mode runs retrieval → decision per backend (not all 9 stages), since
            divergence originates in retrieval. Max 5 queries per run.
          </p>
        </div>

        <div>
          {stats ? (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-3"
              data-testid="compare-stats"
            >
              <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Decision agreement
                </p>
                <p
                  className="mt-3 font-heading text-3xl font-semibold text-white"
                  data-testid="stat-agreement-rate"
                >
                  {Math.round(stats.agreement_rate * 100)}%
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {stats.agreements}/{stats.compared} compared
                </p>
              </div>
              <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Avg latency
                </p>
                <p className="mt-3 font-mono text-sm text-zinc-200" data-testid="stat-latency">
                  qdrant{" "}
                  <span className="text-[#34d399]">{stats.avg_latency_qdrant_ms}ms</span>
                </p>
                <p className="mt-1 font-mono text-sm text-zinc-200">
                  pageindex{" "}
                  <span className="text-[#fbbf24]">{stats.avg_latency_pageindex_ms}ms</span>
                </p>
              </div>
              <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  Avg evidence overlap
                </p>
                <p
                  className="mt-3 font-heading text-3xl font-semibold text-white"
                  data-testid="stat-evidence-overlap"
                >
                  {Math.round(stats.avg_evidence_overlap * 100)}%
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {divergent.length} divergent case(s)
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              testId="compare-empty-state"
              icon={<GitCompare className="size-5" />}
              title="No comparison run yet"
              description="Pick past queries or type test ones on the left, then run them through both retrieval backends to see where they disagree."
            />
          )}

          {result ? (
            <>
              {divergent.length > 0 ? (
                <>
                  <h2 className="mt-8 mb-3 text-base font-semibold text-white/95">
                    Divergent cases ({divergent.length})
                  </h2>
                  <div className="space-y-4" data-testid="compare-divergent-list">
                    {result.cases.map((c, i) =>
                      c.decisions_agree ? null : <CaseCard key={i} c={c} index={i} />,
                    )}
                  </div>
                </>
              ) : (
                <p
                  className="mt-8 rounded-lg border border-[#0f5f4a] bg-[#10b98114] p-4 text-xs text-[#34d399]"
                  data-testid="compare-no-divergence"
                >
                  Both backends reached the same decision on every query in this run.
                </p>
              )}

              <h2 className="mt-8 mb-3 text-base font-semibold text-white/95">
                All cases ({result.cases.length})
              </h2>
              <div className="space-y-4" data-testid="compare-all-list">
                {result.cases.map((c, i) => (
                  <CaseCard key={`all-${i}`} c={c} index={i} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
