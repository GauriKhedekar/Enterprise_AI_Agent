import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RotateCw, Trash2 } from "lucide-react";
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
import { PROVIDER_LABELS } from "@/lib/types";
import type { ApiKeyPublic, Me, Provider } from "@/lib/types";

const KEYS = ["company", "api-keys"];

function errText(err: unknown, fallback: string): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
  return typeof detail === "string" ? detail : fallback;
}

export default function CompanyApiKeys({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [rotateTarget, setRotateTarget] = useState<ApiKeyPublic | null>(null);
  const [rotateValue, setRotateValue] = useState("");

  const keys = useQuery<ApiKeyPublic[]>({
    queryKey: KEYS,
    queryFn: () => apiGet<ApiKeyPublic[]>("/company/api-keys"),
  });
  const list = keys.isError ? [] : (keys.data ?? []);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: KEYS });
    void qc.invalidateQueries({ queryKey: ["company", "dashboard"] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost<ApiKeyPublic>("/company/api-keys", {
        provider,
        label,
        value,
        endpoint: provider === "qdrant" ? endpoint : null,
      }),
    onSuccess: () => {
      toast.success("API key stored (encrypted)");
      setAddOpen(false);
      setLabel("");
      setValue("");
      setEndpoint("");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not store the key")),
  });

  const rotate = useMutation({
    mutationFn: () =>
      apiPost<ApiKeyPublic>(`/company/api-keys/${rotateTarget?.id}/rotate`, { value: rotateValue }),
    onSuccess: () => {
      toast.success("API key rotated");
      setRotateTarget(null);
      setRotateValue("");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not rotate the key")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/company/api-keys/${id}`),
    onSuccess: () => {
      toast.success("API key revoked");
      invalidate();
    },
    onError: (e) => toast.error(errText(e, "Could not revoke the key")),
  });

  return (
    <AppShell
      me={me}
      title="AI & Vector Provider Credentials"
      subtitle="Keys are encrypted server-side with a master key and are never returned in plaintext — only the last four characters are ever displayed."
      actions={
        <Button
          onClick={() => setAddOpen(true)}
          data-testid="add-api-key-button"
          className="active:scale-[0.98] transition-transform duration-100"
        >
          Configure API key
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          testId="api-keys-empty-state"
          icon={<KeyRound className="size-5" />}
          title="No AI backends configured"
          description="Configure your Gemini API key or Qdrant / PageIndex vector endpoints to activate automated policy answers."
          actionLabel="Configure API Key"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1c2230]">
          <table className="w-full text-sm" data-testid="api-keys-table">
            <thead className="bg-[#0e1118] text-left">
              <tr className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Secret</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((k) => (
                <tr
                  key={k.id}
                  data-testid={`api-key-row-${k.id}`}
                  className="border-t border-[#1c2230] bg-[#11141d] transition-colors duration-150 hover:bg-[#161b26]"
                >
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className="border-[#2c3348] bg-[#4f46e526] font-mono text-[11px] text-[#c7d2fe]"
                    >
                      {PROVIDER_LABELS[k.provider]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-zinc-200">
                    {k.label}
                    {k.endpoint ? (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                        {k.endpoint}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    <span data-testid={`api-key-masked-${k.id}`}>••••••••••••{k.last_four}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                    {new Date(k.created_at).toLocaleDateString()}
                    {k.rotated_at ? (
                      <span className="ml-2 text-[#fbbf24]">rotated</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRotateTarget(k);
                          setRotateValue("");
                        }}
                        data-testid={`rotate-api-key-${k.id}`}
                      >
                        <RotateCw className="size-3.5" /> Rotate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(k.id)}
                        data-testid={`delete-api-key-${k.id}`}
                        className="text-[#f87171] hover:text-[#fca5a5]"
                      >
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="add-api-key-dialog">
          <DialogHeader>
            <DialogTitle>Configure API key</DialogTitle>
            <DialogDescription>
              The value is encrypted immediately and cannot be read back afterwards.
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
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v: string) => setProvider(v as Provider)}
              >
                <SelectTrigger id="provider" data-testid="api-key-provider-select">
                  <SelectValue>{(v) => PROVIDER_LABELS[v as Provider]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini" data-testid="provider-option-gemini">
                    Google Gemini
                  </SelectItem>
                  <SelectItem value="qdrant" data-testid="provider-option-qdrant">
                    Qdrant Vector DB
                  </SelectItem>
                  <SelectItem value="pageindex" data-testid="provider-option-pageindex">
                    PageIndex
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input
                id="label"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Gemini Production"
                data-testid="api-key-label-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value">Key value</Label>
              <Input
                id="value"
                required
                minLength={4}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste the secret"
                data-testid="api-key-value-input"
                className="font-mono"
              />
            </div>
            {provider === "qdrant" ? (
              <div className="space-y-2">
                <Label htmlFor="endpoint">Cluster URL</Label>
                <Input
                  id="endpoint"
                  required
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://xxxx.aws.cloud.qdrant.io:6333"
                  data-testid="api-key-endpoint-input"
                  className="font-mono"
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={create.isPending}
                data-testid="api-key-submit-button"
              >
                {create.isPending ? "Encrypting…" : "Store key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rotateTarget !== null} onOpenChange={(o) => !o && setRotateTarget(null)}>
        <DialogContent data-testid="rotate-api-key-dialog">
          <DialogHeader>
            <DialogTitle>Rotate {rotateTarget?.label}</DialogTitle>
            <DialogDescription>
              Paste the replacement secret. The previous value is overwritten permanently.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              rotate.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="rotate-value">New key value</Label>
              <Input
                id="rotate-value"
                required
                minLength={4}
                value={rotateValue}
                onChange={(e) => setRotateValue(e.target.value)}
                data-testid="rotate-api-key-value-input"
                className="font-mono"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={rotate.isPending}
                data-testid="rotate-api-key-submit-button"
              >
                {rotate.isPending ? "Rotating…" : "Rotate key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
