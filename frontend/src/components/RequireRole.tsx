import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe, homeFor } from "@/lib/session";
import type { Me, Role } from "@/lib/types";

interface RequireRoleProps {
  role: Role;
  children: (me: Me) => ReactNode;
}

export default function RequireRole({ role, children }: RequireRoleProps) {
  const { data, isLoading, isError } = useMe();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          Verifying session…
        </div>
      </div>
    );
  }

  if (isError || !data) return <Navigate to="/login" replace />;
  if (data.role !== role) return <Navigate to={homeFor(data.role)} replace />;

  return <>{children(data)}</>;
}
