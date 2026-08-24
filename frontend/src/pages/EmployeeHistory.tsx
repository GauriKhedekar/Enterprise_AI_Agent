import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";
import type { Me, Run } from "@/lib/types";

export default function EmployeeHistory({ me }: { me: Me }) {
  const navigate = useNavigate();
  const runs = useQuery<Run[]>({
    queryKey: ["employee", "runs"],
    queryFn: () => apiGet<Run[]>("/employee/runs"),
  });
  const list = runs.isError ? [] : (runs.data ?? []);

  return (
    <AppShell
      me={me}
      title="My Requests"
      subtitle="Every question you submit is logged here with its decision status once automated decisioning goes live."
    >
      {list.length === 0 ? (
        <EmptyState
          testId="employee-runs-empty-state"
          icon={<Clock className="size-5" />}
          title="You haven't asked anything yet"
          description="Submit a policy question from the Compliance Assistant and it will appear here with its status."
          actionLabel="Ask a question"
          onAction={() => navigate("/employee/home")}
        />
      ) : (
        <div className="space-y-3" data-testid="employee-runs-list">
          {list.map((r) => (
            <div
              key={r.id}
              data-testid={`employee-run-${r.id}`}
              className="rounded-lg border border-[#1e2433] bg-[#11141d] p-5 transition-all duration-200 hover:border-[#2d374d]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-2xl text-sm text-zinc-200">{r.query}</p>
                <Badge
                  variant="outline"
                  className="border-[#3d3011] bg-[#f59e0b1f] font-mono text-[11px] text-[#fbbf24]"
                >
                  {r.decision ?? "awaiting review"}
                </Badge>
              </div>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                {new Date(r.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
