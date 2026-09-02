import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Trash2 } from "lucide-react";
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
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { BACKEND_LABELS } from "@/lib/types";
import type { Me, Policy, RetrievalBackend } from "@/lib/types";

const KEY = ["company", "policies"];

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

export default function CompanyPolicies({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [backend, setBackend] = useState<RetrievalBackend>("pageindex");
  const [selected, setSelected] = useState<Policy | null>(null);

  const policies = useQuery<Policy[]>({
    queryKey: KEY,
    queryFn: () => apiGet<Policy[]>("/company/policies"),
  });
  const list = policies.isError ? [] : (policies.data ?? []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["company", "dashboard"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost<Policy>("/company/policies", { title, content, retrieval_backend: backend }),
    onSuccess: () => {
      toast.success("Policy saved");
      setOpen(false);
      setTitle("");
      setContent("");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not save the policy")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/company/policies/${id}`),
    onSuccess: () => {
      toast.success("Policy deleted");
      setSelected(null);
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not delete the policy")),
  });

  return (
    <AppShell
      me={me}
      title="Company Policy Base & RAG Index"
      subtitle="Author policies in Markdown and tag the retrieval backend each one is indexed against."
      actions={
        <Button
          onClick={() => setOpen(true)}
          data-testid="add-policy-button"
          className="active:scale-[0.98] transition-transform duration-100"
        >
          Create policy
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          testId="policies-empty-state"
          icon={<FileText className="size-5" />}
          title="No compliance policies indexed"
          description="Write Markdown policies — Work From Home, Travel, Benefits — so the assistant can retrieve and cite them."
          actionLabel="Create Policy"
          onAction={() => setOpen(true)}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="flex flex-col gap-2.5" data-testid="policies-list">
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p)}
                data-testid={`policy-item-${p.id}`}
                className={
                  "rounded-lg border p-4 text-left transition-all duration-200 " +
                  (selected?.id === p.id
                    ? "border-primary bg-[#151924]"
                    : "border-[#1e2433] bg-[#11141d] hover:border-[#2d374d]")
                }
              >
                <p className="text-sm font-medium text-zinc-100">{p.title}</p>
                <div className="mt-2.5 flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-[#2c3348] bg-[#4f46e526] font-mono text-[10px] text-[#c7d2fe]"
                  >
                    {BACKEND_LABELS[p.retrieval_backend]}
                  </Badge>
                  <span className="font-mono text-[10px] text-zinc-500">
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-[#1e2433] bg-[#11141d] p-6">
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white/95" data-testid="policy-detail-title">
                      {selected.title}
                    </h2>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      Retrieval · {BACKEND_LABELS[selected.retrieval_backend]}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(selected.id)}
                    data-testid={`delete-policy-${selected.id}`}
                    className="text-[#f87171] hover:text-[#fca5a5]"
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
                <pre
                  className="mt-5 max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300"
                  data-testid="policy-detail-content"
                >
                  {selected.content}
                </pre>
              </>
            ) : (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  Select a policy on the left to read its Markdown source.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="policy-form-dialog" className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create policy</DialogTitle>
            <DialogDescription>
              Markdown is stored verbatim and scoped to your company only.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                required
                minLength={2}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Work From Home Policy"
                data-testid="policy-title-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backend">Retrieval backend</Label>
              <Select value={backend} onValueChange={(v: string) => setBackend(v as RetrievalBackend)}>
                <SelectTrigger id="backend" data-testid="policy-backend-select">
                  <SelectValue>{(v) => BACKEND_LABELS[v as RetrievalBackend]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pageindex" data-testid="backend-option-pageindex">
                    PageIndex
                  </SelectItem>
                  <SelectItem value="qdrant" data-testid="backend-option-qdrant">
                    Qdrant
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Markdown content</Label>
              <Textarea
                id="content"
                required
                rows={12}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# Work From Home Policy&#10;&#10;## 1. General Allowance…"
                data-testid="policy-content-input"
                className="font-mono text-xs min-h-[300px] resize-y"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.isPending} data-testid="policy-submit-button">
                {create.isPending ? "Saving…" : "Save policy"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
