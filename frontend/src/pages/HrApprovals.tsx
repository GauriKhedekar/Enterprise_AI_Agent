import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckSquare, X } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { ActionRequest, Me } from "@/lib/types";

const KEY = ["hr", "action-requests"];

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

function RequestRow({
  request,
  showActions,
}: {
  request: ActionRequest;
  showActions: boolean;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const approve = useMutation({
    mutationFn: () =>
      apiPost<ActionRequest>(`/hr/action-requests/${request.id}/approve`, {
        resolution_note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Request approved");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errText(e, "Could not approve the request")),
  });
  const reject = useMutation({
    mutationFn: () =>
      apiPost<ActionRequest>(`/hr/action-requests/${request.id}/reject`, {
        resolution_note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Request rejected");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error(errText(e, "Could not reject the request")),
  });

  return (
    <div className="rounded-lg border border-[#1c2230] bg-[#11141d] p-4" data-testid={`action-request-${request.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-zinc-100">{request.employee_name ?? request.employee_code}</p>
            <Badge variant="outline" className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px] text-[#cbd5e1]">
              {request.employee_code}
            </Badge>
            <Badge variant="outline" className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px] text-[#cbd5e1]">
              {request.tool_name}
            </Badge>
            {request.stage === "manager" ? (
              <Badge
                variant="outline"
                className="border-[#3d3011] bg-[#f59e0b1f] font-mono text-[11px] text-[#fbbf24]"
                data-testid={`action-request-stage-${request.id}`}
              >
                manager step
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 font-mono text-xs text-zinc-500">
            requested {new Date(request.requested_at).toLocaleString()} · run {request.run_id || "unlinked"}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            request.status === "pending"
              ? "border-[#3d3011] bg-[#f59e0b1f] text-[#fbbf24]"
              : request.status === "approved"
                ? "border-[#0f5f4a] bg-[#10b98120] text-[#34d399]"
                : "border-[#4b1d25] bg-[#ef44441a] text-[#fca5a5]"
          }
        >
          {request.status}
        </Badge>
      </div>

      <pre className="mt-3 overflow-auto rounded-md border border-[#1c2230] bg-[#080a0f] p-3 text-xs text-zinc-300">
        {JSON.stringify(request.tool_call_args, null, 2)}
      </pre>

      {showActions ? (
        <div className="mt-3 space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional resolution note"
            data-testid={`action-request-note-${request.id}`}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => reject.mutate()} disabled={reject.isPending || approve.isPending}>
              <X className="size-3.5" /> Reject
            </Button>
            <Button onClick={() => approve.mutate()} disabled={reject.isPending || approve.isPending}>
              <Check className="size-3.5" /> Approve
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 text-xs text-zinc-400">
          Resolved by {request.resolved_by ?? "unknown"}
          {request.resolved_at ? ` on ${new Date(request.resolved_at).toLocaleString()}` : ""}
          {request.resolution_note ? ` · ${request.resolution_note}` : ""}
        </div>
      )}
    </div>
  );
}

export default function HrApprovals({ me }: { me: Me }) {
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const status = tab === "pending" ? "pending" : "all";
  const requests = useQuery<ActionRequest[]>({
    queryKey: [...KEY, status],
    queryFn: () => apiGet<ActionRequest[]>(`/hr/action-requests?status=${status}`),
  });
  const list = requests.isError ? [] : (requests.data ?? []);
  const visible = tab === "pending" ? list : list.filter((r) => r.status !== "pending");

  return (
    <AppShell
      me={me}
      title={me.role === "manager" ? "Team Approvals" : "HR Approvals"}
      subtitle={
        me.role === "manager"
          ? "Review action requests from your direct reports. Approving forwards them to HR for final sign-off."
          : "Review employee action requests before state-changing tools execute."
      }
    >
      <div className="mb-5 flex gap-2" data-testid="hr-approval-tabs">
        <Button variant={tab === "pending" ? "default" : "outline"} onClick={() => setTab("pending")}>
          Pending
        </Button>
        <Button variant={tab === "resolved" ? "default" : "outline"} onClick={() => setTab("resolved")}>
          Resolved
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          testId="hr-approvals-empty-state"
          icon={<CheckSquare className="size-5" />}
          title={tab === "pending" ? "No pending approvals" : "No resolved approvals yet"}
          description="Employee action requests appear here when a governed action tool requires HR approval."
        />
      ) : (
        <div className="space-y-3" data-testid="hr-action-requests-list">
          {visible.map((request) => (
            <RequestRow key={request.id} request={request} showActions={request.status === "pending"} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
