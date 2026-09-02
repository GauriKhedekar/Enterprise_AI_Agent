import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Trash2, Users } from "lucide-react";
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
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Employee, EmploymentType, InviteResult, Me } from "@/lib/types";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/types";

const KEY = ["company", "employees"];

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

interface FormState {
  name: string;
  email: string;
  department: string;
  joining_date: string;
  employment_status: string;
  employment_type: EmploymentType;
  manager_employee_code: string;
}

const BLANK: FormState = {
  name: "",
  email: "",
  department: "",
  joining_date: "",
  employment_status: "active",
  employment_type: "full_time",
  manager_employee_code: "",
};

export default function CompanyEmployees({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const canManage = me.role === "company_admin";

  const employees = useQuery<Employee[]>({
    queryKey: KEY,
    queryFn: () => apiGet<Employee[]>("/company/employees"),
  });
  const list = employees.isError ? [] : (employees.data ?? []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["company", "dashboard"] });
  };

  const openAdd = () => {
    setEditing(null);
    setForm(BLANK);
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      name: emp.name,
      email: emp.email ?? "",
      department: emp.department,
      joining_date: emp.joining_date.slice(0, 10),
      employment_status: emp.employment_status,
      employment_type: emp.employment_type,
      manager_employee_code: emp.manager_employee_code ?? "",
    });
    setFormOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return apiPut<Employee>(`/company/employees/${editing.id}`, {
          name: form.name,
          department: form.department,
          joining_date: form.joining_date,
          employment_status: form.employment_status,
          employment_type: form.employment_type,
          manager_employee_code: form.manager_employee_code.trim() === "" ? null : form.manager_employee_code.trim(),
        });
      }
      return apiPost<Employee>("/company/employees", {
        name: form.name,
        email: form.email.trim() === "" ? null : form.email.trim(),
        department: form.department,
        joining_date: form.joining_date,
        employment_status: form.employment_status,
        employment_type: form.employment_type,
        manager_employee_code: form.manager_employee_code.trim() === "" ? null : form.manager_employee_code.trim(),
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Employee updated" : "Employee added");
      setFormOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not save the employee")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/company/employees/${id}`),
    onSuccess: () => {
      toast.success("Employee removed");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not remove the employee")),
  });

  const sendInvite = useMutation({
    mutationFn: (id: string) => apiPost<InviteResult>("/company/employees/invite", { employee_id: id }),
    onSuccess: (result) => {
      setInvite(result);
      toast.success(
        result.email_sent ? `Invite emailed to ${result.email}` : "Invite link generated",
      );
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not send the invite")),
  });

  return (
    <AppShell
      me={me}
      title="Employee Directory & Service Tenure"
      subtitle="Service months are recalculated server-side from each joining date, so policy rules like the six-month WFH minimum stay accurate."
      actions={
        canManage ? (
        <Button
          onClick={openAdd}
          data-testid="add-employee-button"
          className="active:scale-[0.98] transition-transform duration-100"
        >
          Add employee
        </Button>
        ) : null
      }
    >
      {list.length === 0 ? (
        <EmptyState
          testId="employees-empty-state"
          icon={<Users className="size-5" />}
          title="No employees registered yet"
          description="Add company members manually, then send email invites with secure onboarding links."
          actionLabel={canManage ? "Add First Employee" : undefined}
          onAction={canManage ? openAdd : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1c2230]">
          <table className="w-full text-sm" data-testid="employees-table">
            <thead className="bg-[#0e1118] text-left">
              <tr className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Tenure</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                {canManage ? <th className="px-4 py-3 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((emp) => (
                <tr
                  key={emp.id}
                  data-testid={`employee-row-${emp.employee_code}`}
                  className="border-t border-[#1c2230] bg-[#11141d] transition-colors duration-150 hover:bg-[#161b26]"
                >
                  <td className="px-4 py-3 font-mono text-xs text-[#c7d2fe]">
                    {emp.employee_code}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-zinc-100">{emp.name}</p>
                    <p className="font-mono text-[11px] text-zinc-500">{emp.email ?? "no email"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px] text-[#cbd5e1]"
                    >
                      {emp.department}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {emp.joining_date.slice(0, 10)}
                  </td>
                  <td
                    className="px-4 py-3 font-mono text-xs"
                    data-testid={`employee-tenure-${emp.employee_code}`}
                  >
                    <span className={emp.service_months >= 6 ? "text-[#34d399]" : "text-[#fbbf24]"}>
                      {emp.service_months} mo
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    data-testid={`employee-type-${emp.employee_code}`}
                  >
                    <Badge
                      variant="outline"
                      className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px] text-[#cbd5e1]"
                    >
                      {EMPLOYMENT_TYPE_LABELS[emp.employment_type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-300">{emp.employment_status}</td>
                  {canManage ? (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!emp.email || sendInvite.isPending}
                        onClick={() => sendInvite.mutate(emp.id)}
                        data-testid={`invite-employee-${emp.employee_code}`}
                      >
                        <Mail className="size-3.5" /> Invite
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(emp)}
                        data-testid={`edit-employee-${emp.employee_code}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(emp.id)}
                        data-testid={`delete-employee-${emp.employee_code}`}
                        className="text-[#f87171] hover:text-[#fca5a5]"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent data-testid="employee-form-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add employee"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the directory record. The employee code stays fixed."
                : "An employee code is assigned automatically once the record is created."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="employee-name-input"
              />
            </div>
            {!editing ? (
              <div className="space-y-2">
                <Label htmlFor="email">Work email (for invites)</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  data-testid="employee-email-input"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Input
                id="department"
                required
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                data-testid="employee-department-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="joining">Joining date</Label>
                <Input
                  id="joining"
                  type="date"
                  required
                  value={form.joining_date}
                  onChange={(e) => setForm({ ...form, joining_date: e.target.value })}
                  data-testid="employee-joining-date-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Employment status</Label>
                <Input
                  id="status"
                  required
                  value={form.employment_status}
                  onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
                  data-testid="employee-status-input"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="employment-type">Employment type</Label>
              <Select
                value={form.employment_type}
                onValueChange={(value: string) =>
                  setForm({ ...form, employment_type: value as EmploymentType })
                }
              >
                <SelectTrigger id="employment-type" data-testid="employee-type-select">
                  <SelectValue>
                    {(v) => EMPLOYMENT_TYPE_LABELS[v as EmploymentType]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time" data-testid="employee-type-option-full_time">
                    Full-time
                  </SelectItem>
                  <SelectItem value="part_time" data-testid="employee-type-option-part_time">
                    Part-time
                  </SelectItem>
                  <SelectItem value="contract" data-testid="employee-type-option-contract">
                    Contract
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manager-code">Manager employee code (optional)</Label>
              <Input
                id="manager-code"
                value={form.manager_employee_code}
                onChange={(e) => setForm({ ...form, manager_employee_code: e.target.value })}
                placeholder="e.g. EMP-0007"
                data-testid="employee-manager-input"
              />
              <p className="text-[11px] text-zinc-500">
                If set and that manager has a login, this employee's action requests route to
                the manager for approval before HR.
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending} data-testid="employee-submit-button">
                {save.isPending ? "Saving…" : editing ? "Save changes" : "Add employee"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={invite !== null} onOpenChange={(o) => !o && setInvite(null)}>
        <DialogContent data-testid="invite-result-dialog">
          <DialogHeader>
            <DialogTitle>Invitation ready</DialogTitle>
            <DialogDescription>
              {invite?.email_sent
                ? `An onboarding email was sent to ${invite?.email}.`
                : `Email delivery is not configured, so share this secure link with ${invite?.email} directly.`}
            </DialogDescription>
          </DialogHeader>
          <p
            className="rounded-md border border-[#1f2636] bg-[#0a0c12] p-3 font-mono text-xs break-all text-[#c7d2fe]"
            data-testid="invite-link-text"
          >
            {invite ? `${window.location.origin}/invite/${invite.token}` : ""}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInvite(null)}
              data-testid="invite-result-close-button"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
