import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { BACKEND_LABELS } from "@/lib/types";
import type { Employee, Me, Policy, Run } from "@/lib/types";

export default function EmployeeHome({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const profile = useQuery<Employee | null>({
    queryKey: ["employee", "profile"],
    queryFn: () => apiGet<Employee | null>("/employee/profile"),
  });
  const policies = useQuery<Policy[]>({
    queryKey: ["employee", "policies"],
    queryFn: () => apiGet<Policy[]>("/employee/policies"),
  });

  const emp = profile.isError ? null : profile.data;
  const policyList = policies.isError ? [] : (policies.data ?? []);

  const submit = useMutation({
    mutationFn: () => apiPost<Run>("/employee/runs", { query }),
    onSuccess: () => {
      setSubmitted(true);
      setQuery("");
      toast.success("Your request has been received");
      void qc.invalidateQueries({ queryKey: ["employee", "runs"] });
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(typeof detail === "string" ? detail : "Could not submit your question");
    },
  });

  return (
    <AppShell
      me={me}
      title="Compliance Assistant"
      subtitle="Ask about company policy — eligibility, leave, remote work. Requests are logged against your company for review."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
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
              rows={5}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSubmitted(false);
              }}
              placeholder="Am I eligible to work from home two days a week?"
              data-testid="ask-question-input"
              className="mt-3"
            />
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Automated decisioning is not enabled yet — your request is queued for review.
              </p>
              <Button
                type="submit"
                disabled={submit.isPending}
                data-testid="ask-question-submit-button"
                className="active:scale-[0.98] transition-transform duration-100"
              >
                <Send className="size-3.5" /> {submit.isPending ? "Submitting…" : "Submit"}
              </Button>
            </div>
          </form>

          {submitted ? (
            <div
              className="animate-rise mt-6 flex items-start gap-3 rounded-lg border border-[#0f5f4a] bg-[#10b98114] p-4"
              data-testid="ask-question-confirmation"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#34d399]" />
              <div>
                <p className="text-sm font-medium text-[#34d399]">Your request has been received</p>
                <p className="mt-1 text-xs text-zinc-400">
                  It is logged under your employee record and visible in My Requests.
                </p>
              </div>
            </div>
          ) : null}
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
        </aside>
      </div>
    </AppShell>
  );
}
