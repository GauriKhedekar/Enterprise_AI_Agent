import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AuthLayout from "@/components/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiPost } from "@/lib/api";
import { ME_KEY } from "@/lib/session";
import type { Me } from "@/lib/types";

export default function Signup() {
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<Me>("/auth/signup", { company_name: companyName, email, password }),
    onSuccess: (me) => {
      qc.clear();
      qc.setQueryData(ME_KEY, me);
      toast.success(`${me.company_name} workspace created`);
      navigate("/company/dashboard", { replace: true });
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? (err.body as { detail?: string })?.detail : null;
      toast.error(typeof detail === "string" ? detail : "Unable to create the workspace");
    },
  });

  return (
    <AuthLayout
      eyebrow="Company onboarding"
      headline="Stand up your compliance workspace in one step."
      blurb="Creating a workspace provisions an isolated tenant and makes you its first company administrator. You can invite employees straight after."
      bullets={[
        "Your tenant starts empty — nothing is shared across companies",
        "Bring your own Gemini, Qdrant, or PageIndex credentials",
        "Author policies in Markdown and tag their retrieval backend",
      ]}
    >
      <h1 className="text-2xl font-semibold text-white/95">Create a workspace</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You become the first company administrator.
      </p>

      <form
        className="mt-8 space-y-4"
        data-testid="signup-form"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="company">Company name</Label>
          <Input
            id="company"
            required
            minLength={2}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Acme Robotics"
            data-testid="signup-company-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@company.com"
            data-testid="signup-email-input"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            data-testid="signup-password-input"
          />
        </div>
        <Button
          type="submit"
          className="w-full active:scale-[0.98] transition-transform duration-100"
          disabled={mutation.isPending}
          data-testid="signup-submit-button"
        >
          {mutation.isPending ? "Creating workspace…" : "Create workspace"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Already onboarded?{" "}
        <Link to="/login" className="text-[#818cf8] hover:underline" data-testid="login-link">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
