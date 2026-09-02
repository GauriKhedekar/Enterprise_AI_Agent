import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Pencil, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { McpToolKind, McpToolPublic, Me } from "@/lib/types";

const KEY = ["company", "mcp-tools"];

interface FormState {
  name: string;
  display_name: string;
  description: string;
  kind: McpToolKind;
  server_url: string;
  input_schema: string;
  enabled_for_employees: boolean;
  requires_human_approval: boolean;
}

const BLANK: FormState = {
  name: "",
  display_name: "",
  description: "",
  kind: "read",
  server_url: "local://hr-mcp",
  input_schema: '{\n  "type": "object",\n  "properties": {}\n}',
  enabled_for_employees: true,
  requires_human_approval: true,
};

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

function parseSchema(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Schema must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export default function CompanyMcpTools({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<McpToolPublic | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const tools = useQuery<McpToolPublic[]>({
    queryKey: KEY,
    queryFn: () => apiGet<McpToolPublic[]>("/company/mcp-tools"),
  });
  const list = tools.isError ? [] : (tools.data ?? []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["company", "dashboard"] });
  };

  const openAdd = () => {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  };

  const openEdit = (tool: McpToolPublic) => {
    setEditing(tool);
    setForm({
      name: tool.name,
      display_name: tool.display_name,
      description: tool.description,
      kind: tool.kind,
      server_url: tool.server_url,
      input_schema: JSON.stringify(tool.input_schema, null, 2),
      enabled_for_employees: tool.enabled_for_employees,
      requires_human_approval: tool.requires_human_approval,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        display_name: form.display_name,
        description: form.description,
        kind: form.kind,
        server_url: form.server_url,
        input_schema: parseSchema(form.input_schema),
        enabled_for_employees: form.enabled_for_employees,
        requires_human_approval: form.kind === "action" ? form.requires_human_approval : false,
      };
      if (editing) {
        return apiPut<McpToolPublic>(`/company/mcp-tools/${editing.id}`, payload);
      }
      return apiPost<McpToolPublic>("/company/mcp-tools", { ...payload, name: form.name });
    },
    onSuccess: () => {
      toast.success(editing ? "MCP tool updated" : "MCP tool added");
      setOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not save the MCP tool")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/company/mcp-tools/${id}`),
    onSuccess: () => {
      toast.success("MCP tool removed");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not remove the MCP tool")),
  });

  return (
    <AppShell
      me={me}
      title="MCP Tool Access"
      subtitle="Register company MCP tools and decide which read or action tools employees may use through the compliance agent."
      actions={<Button onClick={openAdd} data-testid="add-mcp-tool-button">Add MCP tool</Button>}
    >
      {list.length === 0 ? (
        <EmptyState
          testId="mcp-tools-empty-state"
          icon={<Cable className="size-5" />}
          title="No MCP tools configured"
          description="Add tools such as get_employee_details or submit_wfh_request, then enable employee access."
          actionLabel="Add MCP Tool"
          onAction={openAdd}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1c2230]">
          <table className="w-full text-sm" data-testid="mcp-tools-table">
            <thead className="bg-[#0e1118] text-left">
              <tr className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-4 py-3">Tool</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Server</th>
                <th className="px-4 py-3">Employee access</th>
                <th className="px-4 py-3">Approval</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((tool) => (
                <tr key={tool.id} className="border-t border-[#1c2230] bg-[#11141d]">
                  <td className="px-4 py-3">
                    <p className="text-zinc-100">{tool.display_name}</p>
                    <p className="font-mono text-[11px] text-zinc-500">{tool.name}</p>
                    <p className="mt-1 max-w-lg text-xs text-zinc-400">{tool.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-[#2c3348] bg-[#94a3b81a] font-mono text-[11px]">
                      {tool.kind}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{tool.server_url}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={tool.enabled_for_employees ? "border-[#0f5f4a] bg-[#10b98120] text-[#34d399]" : "border-[#3d3011] bg-[#f59e0b1f] text-[#fbbf24]"}
                    >
                      {tool.enabled_for_employees ? "enabled" : "disabled"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-[#2c3348] bg-[#94a3b81a] text-[#cbd5e1]">
                      {tool.kind === "action" && tool.requires_human_approval ? "HR required" : "not required"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(tool)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(tool.id)} className="text-[#f87171] hover:text-[#fca5a5]">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="mcp-tool-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add MCP tool"}</DialogTitle>
            <DialogDescription>
              Tool names should match the MCP server method the agent is allowed to call.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                parseSchema(form.input_schema);
                save.mutate();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Schema must be valid JSON");
              }
            }}
          >
            {!editing ? (
              <div className="space-y-2">
                <Label htmlFor="name">Tool name</Label>
                <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="get_employee_details" />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="display-name">Display name</Label>
                <Input id="display-name" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kind">Kind</Label>
                <Select value={form.kind} onValueChange={(v: string) => setForm({ ...form, kind: v as McpToolKind })}>
                  <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read</SelectItem>
                    <SelectItem value="action">Action</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-url">Server URL</Label>
              <Input id="server-url" required value={form.server_url} onChange={(e) => setForm({ ...form, server_url: e.target.value })} className="font-mono" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input id="description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="input-schema">Input schema</Label>
              <Textarea id="input-schema" required rows={5} value={form.input_schema} onChange={(e) => setForm({ ...form, input_schema: e.target.value })} className="font-mono text-xs" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.enabled_for_employees}
                onChange={(e) => setForm({ ...form, enabled_for_employees: e.target.checked })}
              />
              Enabled for employees
            </label>
            {form.kind === "action" ? (
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.requires_human_approval}
                  onChange={(e) => setForm({ ...form, requires_human_approval: e.target.checked })}
                />
                Require HR approval before execution
              </label>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving..." : "Save tool"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
