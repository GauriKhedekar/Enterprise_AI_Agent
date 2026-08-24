import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { ME_KEY, homeFor } from "@/lib/session";
import type { InviteInfo, Me } from "@/lib/types";

export default function AcceptInvite() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const info = useQuery<InviteInfo>({
    queryKey: ["invite", token],
    queryFn: () => apiGet<InviteInfo>(`/auth/invite/${token}`),
    retry: false,
    enabled: token.length > 0,
  });

  const mutation = useMutation({
    mutationFn: () => apiPost<Me>("/auth/invite/accept", { token, password }),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(ME_KEY, me);
      toast.success("Account activated");
      navigate(homeFor(me.role), { replace: true });
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(typeof detail === "string" ? detail : "Unable to set your password");
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-14">
      <div className="animate-rise w-full max-w-md rounded-xl border border-[#1e2433] bg-[#11141d] p-8">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-primary shadow-[0_0_10px_2px_rgba(79,70,229,0.6)]" />
          <span className="font-heading text-sm font-semibold tracking-tight text-white">
            Adaptive Enterprise Agent
          </span>
        </div>

        <h1 className="mt-6 text-2xl font-semibold text-white/95">Activate your account</h1>

        {info.isError ? (
          <p className="mt-3 text-sm text-[#f87171]" data-testid="invite-invalid-message">
            This invite link is invalid or has already been used. Ask your company administrator to
            resend it.
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="invite-context">
            {info.data
              ? `${info.data.email} · ${info.data.company_name} · code ${info.data.employee_code}`
              : "Loading your invitation…"}
          </p>
        )}

        <form
          className="mt-8 space-y-4"
          data-testid="invite-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="password">Choose a password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              data-testid="invite-password-input"
            />
          </div>
          <Button
            type="submit"
            className="w-full active:scale-[0.98] transition-transform duration-100"
            disabled={mutation.isPending || info.isError}
            data-testid="invite-submit-button"
          >
            {mutation.isPending ? "Activating…" : "Set password & continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
