import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, ChevronDown, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import DecisionBadge from "@/components/DecisionBadge";
import PipelineProgress from "@/components/PipelineProgress";
import RunTrace from "@/components/RunTrace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { BACKEND_LABELS } from "@/lib/types";
import type { Employee, McpToolPublic, Me, Policy, Run } from "@/lib/types";

const EXAMPLES = [
  "Am I eligible to work from home two days a week?",
  "How much annual leave have I accrued so far?",
  "Can I take paid annual leave while on probation?",
];

export default function EmployeeHome({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  const profile = useQuery<Employee | null>({
    queryKey: ["employee", "profile"],
    queryFn: () => apiGet<Employee | null>("/employee/profile"),
  });
  const policies = useQuery<Policy[]>({
    queryKey: ["employee", "policies"],
    queryFn: () => apiGet<Policy[]>("/employee/policies"),
  });
  const mcpTools = useQuery<McpToolPublic[]>({
    queryKey: ["employee", "mcp-tools"],
    queryFn: () => apiGet<McpToolPublic[]>("/employee/mcp-tools"),
  });

  // Poll the run while the background pipeline is still working.
  const run = useQuery<Run>({
    queryKey: ["employee", "run", runId],
    queryFn: () => apiGet<Run>(`/employee/runs/${runId}`),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1200 : false),
  });

  const result = run.isError ? null : (run.data ?? null);
  const running = result?.status === "running";

  const emp = profile.isError ? null : profile.data;
  const policyList = policies.isError ? [] : (policies.data ?? []);
  const toolList = mcpTools.isError ? [] : (mcpTools.data ?? []);

  const submit = useMutation({
    mutationFn: () => apiPost<Run>("/employee/runs", { query }),
    onSuccess: (created) => {
      setRunId(created.id);
      setTraceOpen(false);
      qc.setQueryData(["employee", "run", created.id], created);
      toast.success("Your request has been received");
      void qc.invalidateQueries({ queryKey: ["employee", "runs"] });
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(typeof detail === "string" ? detail : "Could not process your question");
    },
  });

  return (
    <AppShell
      me={me}
      title="Compliance Assistant"
      subtitle="Ask about company policy — eligibility, leave, remote work. Every answer is grounded in your company's policy documents and your own HR record."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-6">
            <form
              data-testid="ask-question-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit.mutate();
              }}
            >
              <Label htmlFor="question" className="text-sm text-zinc-200">
                Ask a question
              </Label>
              <Textarea
                id="question"
                required
                minLength={3}
                rows={4}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Am I eligible to work from home two days a week?"
                data-testid="ask-question-input"
                className="mt-3"
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuery(ex)}
                      data-testid={`example-question-${i}`}
                      className="rounded-full border border-[#1f2636] px-3 py-1 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-primary hover:text-zinc-100"
                    >
                      {ex.length > 38 ? `${ex.slice(0, 38)}…` : ex}
                    </button>
                  ))}
                </div>
                <Button
                  type="submit"
                  disabled={submit.isPending || running}
                  data-testid="ask-question-submit-button"
                  className="active:scale-[0.98] transition-transform duration-100"
                >
                  <Send className="size-3.5" />{" "}
                  {submit.isPending || running ? "Evaluating…" : "Submit"}
                </Button>
              </div>
            </form>

            <PipelineProgress active={running} trace={result?.trace ?? []} />

            {result && !running ? (
              <div className="animate-rise mt-6" data-testid="run-result">
                <div className="rounded-lg border border-[#252d3f] bg-[#151924] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      Decision
                    </p>
                    <DecisionBadge decision={result.decision} testId="run-decision-badge" />
                  </div>
                  <p
                    className="mt-4 text-sm leading-relaxed text-zinc-100"
                    data-testid="run-answer"
                  >
                    {result.answer}
                  </p>
                  {result.action_taken ? (
                    <p
                      className="mt-3 font-mono text-[11px] text-[#34d399]"
                      data-testid="run-action-taken"
                    >
                      Action executed · {result.tool_called}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => setTraceOpen((v) => !v)}
                  data-testid="toggle-trace-button"
                  className="mt-4 flex w-full items-center justify-between rounded-lg border border-[#1e2433] bg-[#11141d] px-4 py-3 text-left transition-colors duration-150 hover:border-[#2d374d]"
                >
                  <span className="text-xs font-medium text-zinc-200">How this was decided</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-500">
                      {result.trace.length} stages
                    </span>
                    <ChevronDown
                      className={`size-3.5 text-zinc-500 transition-transform duration-200 ${traceOpen ? "rotate-180" : ""}`}
                    />
                  </span>
                </button>

                {traceOpen ? (
                  <div className="mt-4" data-testid="run-trace-panel">
                    <RunTrace
                      trace={result.trace}
                      citedEvidence={result.cited_evidence}
                      reasoning={result.reasoning}
                      latencyMs={result.latency_ms}
                      idPrefix="run"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Your record
            </p>
            {emp ? (
              <dl className="mt-3 space-y-2.5 text-sm" data-testid="employee-profile-card">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Name</dt>
                  <dd className="text-zinc-200">{emp.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Code</dt>
                  <dd className="font-mono text-xs text-[#c7d2fe]">{emp.employee_code}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Department</dt>
                  <dd className="text-zinc-200">{emp.department}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Tenure</dt>
                  <dd
                    className={
                      "font-mono text-xs " +
                      (emp.service_months >= 6 ? "text-[#34d399]" : "text-[#fbbf24]")
                    }
                    data-testid="employee-profile-tenure"
                  >
                    {emp.service_months} months
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                No directory record is linked to your login yet.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Available policies
            </p>
            {policyList.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="employee-policies-empty">
                No policies have been published by your company yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5" data-testid="employee-policies-list">
                {policyList.map((p) => (
                  <li key={p.id} className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-zinc-200">{p.title}</p>
                      <Badge
                        variant="outline"
                        className="mt-1 border-[#2c3348] bg-[#94a3b81a] font-mono text-[10px] text-[#cbd5e1]"
                      >
                        {BACKEND_LABELS[p.retrieval_backend]}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              Enabled MCP tools
            </p>
            {toolList.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground" data-testid="employee-mcp-tools-empty">
                No MCP tools have been enabled by your company admin yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5" data-testid="employee-mcp-tools-list">
                {toolList.map((tool) => (
                  <li key={tool.id} className="flex items-start gap-2.5">
                    <Cable className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-zinc-200">{tool.display_name}</p>
                      <Badge
                        variant="outline"
                        className="mt-1 border-[#2c3348] bg-[#94a3b81a] font-mono text-[10px] text-[#cbd5e1]"
                      >
                        {tool.kind}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
