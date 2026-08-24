import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, FileText, KeyRound, Users } from "lucide-react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import type { DashboardStats, Me, Run } from "@/lib/types";

const ALL_PROVIDERS = ["gemini", "qdrant", "pageindex"] as const;

export default function CompanyDashboard({ me }: { me: Me }) {
  const stats = useQuery<DashboardStats>({
    queryKey: ["company", "dashboard"],
    queryFn: () => apiGet<DashboardStats>("/company/dashboard"),
  });
  const runs = useQuery<Run[]>({
    queryKey: ["company", "runs"],
    queryFn: () => apiGet<Run[]>("/company/runs"),
  });

  const s = stats.isError ? undefined : stats.data;
  const runList = runs.isError ? [] : (runs.data ?? []);

  const cards = [
    {
      label: "Employees",
      value: s?.employee_count,
      icon: <Users className="size-4" />,
      hint: s ? `${s.pending_invites} invite(s) pending` : "—",
      to: "/company/employees",
      testId: "stat-employees",
    },
    {
      label: "Policies indexed",
      value: s?.policy_count,
      icon: <FileText className="size-4" />,
      hint: "Markdown policy documents",
      to: "/company/policies",
      testId: "stat-policies",
    },
    {
      label: "Keys configured",
      value: s?.keys_configured,
      icon: <KeyRound className="size-4" />,
      hint: s ? `${s.providers_configured.length}/3 providers` : "—",
      to: "/company/api-keys",
      testId: "stat-keys",
    },
  ];

  return (
    <AppShell
      me={me}
      title="Enterprise Compliance Overview"
      subtitle="Tenant-scoped snapshot of your directory, policy base, and AI backend credentials."
    >
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            data-testid={c.testId}
            className="group rounded-lg border border-[#1e2433] bg-[#11141d] p-6 transition-all duration-200 hover:border-[#2d374d]"
          >
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                {c.label}
              </p>
              <span className="text-zinc-500 transition-colors duration-150 group-hover:text-[#818cf8]">
                {c.icon}
              </span>
            </div>
            <p
              className="mt-4 font-heading text-4xl font-semibold text-white"
              data-testid={`${c.testId}-value`}
            >
              {c.value ?? "—"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{c.hint}</p>
          </Link>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-[#1e2433] bg-[#11141d] p-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          Provider status
        </p>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="provider-status-row">
          {ALL_PROVIDERS.map((p) => {
            const on = s?.providers_configured.includes(p) ?? false;
            return (
              <Badge
                key={p}
                variant="outline"
                data-testid={`provider-status-${p}`}
                className={
                  on
                    ? "border-[#0f5f4a] bg-[#10b98120] font-mono text-[11px] text-[#34d399]"
                    : "border-[#3d3011] bg-[#f59e0b1f] font-mono text-[11px] text-[#fbbf24]"
                }
              >
                <span className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />
                {p} · {on ? "configured" : "not configured"}
              </Badge>
            );
          })}
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/95">Recent agent runs</h2>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            {runList.length} logged
          </span>
        </div>

        {runList.length === 0 ? (
          <EmptyState
            testId="runs-empty-state"
            icon={<Activity className="size-5" />}
            title="No policy queries processed yet"
            description="When employees ask policy questions or check WFH eligibility, their query decisions and citations appear here."
            actionLabel={undefined}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#1c2230]">
            <table className="w-full text-sm">
              <thead className="bg-[#0e1118] text-left">
                <tr className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  <th className="px-4 py-3">Query</th>
                  <th className="px-4 py-3">Decision</th>
                  <th className="px-4 py-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {runList.map((r) => (
                  <tr
                    key={r.id}
                    data-testid={`run-row-${r.id}`}
                    className="border-t border-[#1c2230] bg-[#11141d] transition-colors duration-150 hover:bg-[#161b26]"
                  >
                    <td className="max-w-md truncate px-4 py-3 text-zinc-200">{r.query}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px] text-[#cbd5e1]"
                      >
                        {r.decision ?? "pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/company/employees"
          className={buttonVariants({ variant: "default" })}
          data-testid="quick-add-employee"
        >
          Manage employees
        </Link>
        <Link
          to="/company/policies"
          className={buttonVariants({ variant: "outline" })}
          data-testid="quick-add-policy"
        >
          Author a policy
        </Link>
      </div>
    </AppShell>
  );
}
