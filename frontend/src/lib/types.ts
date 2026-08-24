// Hand-written mirrors of backend/models/schemas.py — keep both sides in sync in one edit.
export type Provider = "gemini" | "qdrant" | "pageindex";
export type RetrievalBackend = "qdrant" | "pageindex";
export type Role = "company_admin" | "employee";

export interface Me {
  id: string;
  company_id: string;
  company_name: string;
  email: string;
  role: Role;
  employee_code: string | null;
}

export interface InviteInfo {
  email: string;
  company_name: string;
  employee_code: string;
}

export interface ApiKeyPublic {
  id: string;
  provider: Provider;
  label: string;
  last_four: string;
  created_by: string;
  created_at: string;
  rotated_at: string | null;
}

export interface Employee {
  id: string;
  company_id: string;
  employee_code: string;
  name: string;
  email: string | null;
  department: string;
  joining_date: string;
  service_months: number;
  employment_status: string;
  has_login: boolean;
}

export interface InviteResult {
  email: string;
  token: string;
  invite_url: string;
  email_sent: boolean;
}

export interface Policy {
  id: string;
  company_id: string;
  title: string;
  content: string;
  retrieval_backend: RetrievalBackend;
  created_at: string;
}

export interface Run {
  id: string;
  company_id: string;
  user_id: string;
  query: string;
  decision: string | null;
  cited_evidence: Record<string, unknown>[];
  tool_called: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface DashboardStats {
  company_name: string;
  employee_count: number;
  policy_count: number;
  keys_configured: number;
  providers_configured: string[];
  run_count: number;
  pending_invites: number;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  gemini: "Google Gemini",
  qdrant: "Qdrant Vector DB",
  pageindex: "PageIndex",
};

export const BACKEND_LABELS: Record<RetrievalBackend, string> = {
  qdrant: "Qdrant",
  pageindex: "PageIndex",
};
