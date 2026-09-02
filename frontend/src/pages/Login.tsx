import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiPost } from "@/lib/api";
import { ME_KEY, homeFor } from "@/lib/session";
import type { Me } from "@/lib/types";

function roleName(role: Me["role"]): string {
  if (role === "company_admin") return "company admin";
  if (role === "hr") return "HR";
  return "employee";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiPost<Me>("/auth/login", { email, password }),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(ME_KEY, me);
      toast.success(`Signed in as ${roleName(me.role)}`);
      navigate(homeFor(me.role), { replace: true });
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(detail ?? "Unable to sign in");
    },
  });

  return (
    <AuthLayout
      eyebrow="Unified access"
      headline="One sign-in for every role."
      blurb="Adaptive Enterprise Agent routes you by role the moment you authenticate: administrators land on the compliance console, HR on approvals, and employees on the policy assistant."
      bullets={[
        "Company data is scoped by tenant on every API call",
        "Provider credentials are encrypted with a server-held master key",
        "Employees join by invitation only - no open self-signup",
      ]}
    >
      <h1 className="text-2xl font-semibold text-white/95">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use your work email and password to continue.
      </p>

      <form
        className="mt-8 space-y-4"
        data-testid="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            data-testid="login-email-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="********"
            data-testid="login-password-input"
          />
        </div>
        <Button
          type="submit"
          className="w-full active:scale-[0.98] transition-transform duration-100"
          disabled={mutation.isPending}
          data-testid="login-submit-button"
        >
          {mutation.isPending ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Registering a company?{" "}
        <Link to="/signup" className="text-[#818cf8] hover:underline" data-testid="signup-link">
          Create a workspace
        </Link>
      </p>
    </AuthLayout>
  );
}
