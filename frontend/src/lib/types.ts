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
  endpoint: string | null;
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

export type Decision = "ALLOW" | "DENY" | "NOT_ELIGIBLE" | "INSUFFICIENT_INFO" | "BLOCKED";

export interface CitedEvidence {
  text: string;
  source: string;
  match_score: number | null;
}

export interface TraceStage {
  name: string;
  status: string;
  summary: string;
  output: Record<string, unknown>;
  latency_ms: number;
}

export interface Run {
  id: string;
  company_id: string;
  user_id: string;
  employee_code: string | null;
  employee_name: string | null;
  query: string;
  status: string;
  decision: Decision | null;
  reasoning: string;
  answer: string;
  cited_evidence: CitedEvidence[];
  tool_called: string | null;
  action_taken: boolean;
  policy_required: boolean | null;
  enterprise_data_required: boolean | null;
  action_required: boolean | null;
  blocked: boolean;
  trace: TraceStage[];
  latency_ms: number | null;
  created_at: string;
}

export interface PaginatedRuns {
  items: Run[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  decision_counts: Record<string, number>;
}

export const STAGE_LABELS: Record<string, string> = {
  credentials: "Credential check",
  input_guardrail: "1 · Input guardrail",
  requirement_classifier: "2 · Requirement classifier",
  policy_retrieval: "3 · Policy retrieval",
  enterprise_data_lookup: "4 · Enterprise data lookup",
  evidence_combiner: "5 · Evidence combiner",
  decision: "6 · Decision",
  tool_gate: "7 · Tool gate",
  output_validation: "8 · Output validation",
};

export const PIPELINE_ORDER = [
  "credentials",
  "input_guardrail",
  "requirement_classifier",
  "policy_retrieval",
  "enterprise_data_lookup",
  "evidence_combiner",
  "decision",
  "tool_gate",
  "output_validation",
];

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
