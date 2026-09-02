import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import type { Me } from "@/lib/types";

export const ME_KEY = ["auth", "me"] as const;

export function useMe() {
  return useQuery<Me>({
    queryKey: ME_KEY,
    queryFn: () => apiGet<Me>("/auth/me"),
    retry: false,
    staleTime: 30_000,
  });
}

export function homeFor(role: Me["role"]): string {
  if (role === "company_admin") return "/company/dashboard";
  if (role === "hr" || role === "manager") return "/hr/approvals";
  return "/employee/home";
}

export function useEndSession() {
  const qc = useQueryClient();
  return async () => {
    try {
      await apiPost("/auth/logout");
    } finally {
      qc.clear();
    }
  };
}
