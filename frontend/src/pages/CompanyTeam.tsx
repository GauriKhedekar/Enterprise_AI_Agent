import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";
import AppShell from "@/components/AppShell";
import EmptyState from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import type { InviteResult, Me, TeamMember } from "@/lib/types";

const KEY = ["company", "team"];

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

export default function CompanyTeam({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"hr" | "manager">("hr");
  const [managerCode, setManagerCode] = useState("");
  const [invite, setInvite] = useState<InviteResult | null>(null);

  const team = useQuery<TeamMember[]>({
    queryKey: KEY,
    queryFn: () => apiGet<TeamMember[]>("/company/team"),
  });
  const list = team.isError ? [] : (team.data ?? []);

  const invalidate = () => void qc.invalidateQueries({ queryKey: KEY });

  const sendInvite = useMutation({
    mutationFn: () =>
      apiPost<InviteResult>("/company/team/invite", {
        email: email.trim(),
        role: inviteRole,
        employee_code: inviteRole === "manager" ? managerCode.trim() : null,
      }),
    onSuccess: (result) => {
      setInvite(result);
      setInviteOpen(false);
      setEmail("");
      setManagerCode("");
      setInviteRole("hr");
      toast.success(
        result.email_sent ? `Invite emailed to ${result.email}` : "Invite link generated",
      );
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not send the invite")),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/company/team/${id}`),
    onSuccess: () => {
      toast.success("HR access removed");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not remove this member")),
  });

  return (
    <AppShell
      me={me}
      title="Team & HR Access"
      subtitle="Invite HR reviewers who can approve or reject employee action requests. HR users set their own password from a secure single-use invite link — they cannot self-register."
      actions={
        <Button
          onClick={() => setInviteOpen(true)}
          data-testid="invite-hr-button"
          className="active:scale-[0.98] transition-transform duration-100"
        >
          <UserPlus className="size-3.5" /> Invite HR
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          testId="team-empty-state"
          icon={<UserCog className="size-5" />}
          title="No team members yet"
          description="Invite an HR reviewer so employee requests can be approved."
          actionLabel="Invite HR"
          onAction={() => setInviteOpen(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1c2230]">
          <table className="w-full text-sm" data-testid="team-table">
            <thead className="bg-[#0e1118] text-left">
              <tr className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((member) => (
                <tr
                  key={member.id}
                  data-testid={`team-row-${member.email}`}
                  className="border-t border-[#1c2230] bg-[#11141d] transition-colors duration-150 hover:bg-[#161b26]"
                >
                  <td className="px-4 py-3 text-zinc-100">{member.email}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        "font-mono text-[11px] " +
                        (member.role === "company_admin"
                          ? "border-[#4f46e5] bg-[#4f46e51a] text-[#c7d2fe]"
                          : "border-[#2c3348] bg-[#94a3b81a] text-[#cbd5e1]")
                      }
                    >
                      {member.role === "company_admin" ? "Company Admin" : member.role === "manager" ? "Manager" : "HR"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex items-center gap-1.5 font-mono text-[11px] " +
                        (member.status === "active" ? "text-[#34d399]" : "text-[#fbbf24]")
                      }
                      data-testid={`team-status-${member.email}`}
                    >
                      <ShieldCheck className="size-3.5" />
                      {member.status === "active" ? "Active" : "Invite pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {member.role === "hr" || member.role === "manager" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke.mutate(member.id)}
                          disabled={revoke.isPending}
                          data-testid={`revoke-hr-${member.email}`}
                          className="text-[#f87171] hover:text-[#fca5a5]"
                        >
                          <Trash2 className="size-3.5" /> Remove
                        </Button>
                      ) : (
                        <span className="font-mono text-[10px] text-zinc-600">owner</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent data-testid="invite-hr-dialog">
          <DialogHeader>
            <DialogTitle>Invite a reviewer</DialogTitle>
            <DialogDescription>
              They receive a single-use link to set a password. HR reviewers see the whole
              approval queue; managers only see requests from their direct reports.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              sendInvite.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v: string) => setInviteRole(v as "hr" | "manager")}>
                <SelectTrigger id="invite-role" data-testid="invite-role-select">
                  <SelectValue>{(v) => (v === "manager" ? "Manager" : "HR reviewer")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hr" data-testid="invite-role-option-hr">HR reviewer</SelectItem>
                  <SelectItem value="manager" data-testid="invite-role-option-manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="hr-email">Work email</Label>
              <Input
                id="hr-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="reviewer@yourcompany.com"
                data-testid="invite-hr-email-input"
              />
            </div>
            {inviteRole === "manager" ? (
              <div className="space-y-2">
                <Label htmlFor="manager-employee-code">Manager's employee code</Label>
                <Input
                  id="manager-employee-code"
                  required
                  value={managerCode}
                  onChange={(e) => setManagerCode(e.target.value)}
                  placeholder="e.g. EMP-0007"
                  data-testid="invite-manager-code-input"
                />
                <p className="text-[11px] text-zinc-500">
                  Employees whose "manager employee code" matches this will route to this
                  manager first.
                </p>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={sendInvite.isPending} data-testid="invite-hr-submit-button">
                {sendInvite.isPending ? "Sending…" : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={invite !== null} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent data-testid="hr-invite-result-dialog">
          <DialogHeader>
            <DialogTitle>HR invitation ready</DialogTitle>
            <DialogDescription>
              {invite?.email_sent
                ? `An onboarding email was sent to ${invite?.email}.`
                : `Email delivery is not configured, so share this secure link with ${invite?.email} directly.`}
            </DialogDescription>
          </DialogHeader>
          <p
            className="rounded-md border border-[#1f2636] bg-[#0a0c12] p-3 font-mono text-xs break-all text-[#c7d2fe]"
            data-testid="hr-invite-link-text"
          >
            {invite ? `${window.location.origin}/invite/${invite.token}` : ""}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvite(null)} data-testid="hr-invite-result-close-button">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
