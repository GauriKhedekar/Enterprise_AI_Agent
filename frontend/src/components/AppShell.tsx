import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Cable,
  CheckSquare,
  Clock,
  FileText,
  GitCompare,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEndSession } from "@/lib/session";
import type { Me } from "@/lib/types";

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Overview", path: "/company/dashboard", icon: <LayoutDashboard className="size-4" /> },
  { label: "Employees", path: "/company/employees", icon: <Users className="size-4" /> },
  { label: "Team & HR", path: "/company/team", icon: <UserCog className="size-4" /> },
  { label: "HR Approvals", path: "/hr/approvals", icon: <CheckSquare className="size-4" /> },
  { label: "Policies & GRC", path: "/company/policies", icon: <FileText className="size-4" /> },
  { label: "Agent Run Log", path: "/company/runs", icon: <Activity className="size-4" /> },
  { label: "Backend Compare", path: "/company/compare", icon: <GitCompare className="size-4" /> },
  { label: "MCP Tools", path: "/company/mcp-tools", icon: <Cable className="size-4" /> },
  { label: "API & AI Backends", path: "/company/api-keys", icon: <KeyRound className="size-4" /> },
];

const HR_NAV: NavItem[] = [
  { label: "Employees", path: "/company/employees", icon: <Users className="size-4" /> },
  { label: "HR Approvals", path: "/hr/approvals", icon: <CheckSquare className="size-4" /> },
];

const EMPLOYEE_NAV: NavItem[] = [
  { label: "Compliance Assistant", path: "/employee/home", icon: <Sparkles className="size-4" /> },
  { label: "My Requests", path: "/employee/history", icon: <Clock className="size-4" /> },
];

interface AppShellProps {
  me: Me;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function AppShell({ me, title, subtitle, actions, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const endSession = useEndSession();
  const nav = me.role === "company_admin" ? ADMIN_NAV : me.role === "hr" ? HR_NAV : EMPLOYEE_NAV;
  const roleLabel =
    me.role === "company_admin"
      ? "Company Admin"
      : me.role === "hr"
        ? "HR"
        : `Employee - ${me.employee_code ?? "unknown"}`;

  const signOut = async () => {
    await endSession();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#1c2230] bg-[#080a0f] md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-[#1c2230] px-5">
          <span className="size-2 rounded-full bg-primary shadow-[0_0_10px_2px_rgba(79,70,229,0.6)]" />
          <span className="font-heading text-sm font-semibold tracking-tight text-white">
            Adaptive Agent
          </span>
        </div>

        <div className="px-5 pt-5 pb-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">Tenant</p>
          <p className="mt-1.5 truncate text-sm font-medium text-zinc-200" data-testid="sidebar-company-name">
            {me.company_name}
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {nav.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                data-testid={`nav-${item.path.split("/").pop()}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "border-primary bg-[#141824] text-white"
                    : "border-transparent text-zinc-400 hover:bg-[#0f1219] hover:text-zinc-100",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#1c2230] p-3">
          <div className="rounded-lg bg-[#0f1219] p-3">
            <p className="truncate text-xs text-zinc-300" data-testid="sidebar-user-email">
              {me.email}
            </p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[#c7d2fe]">
              {roleLabel}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              data-testid="sign-out-button"
              className="mt-2 w-full justify-start gap-2 text-zinc-400 hover:text-white"
            >
              <LogOut className="size-3.5" /> Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[#1c2230] bg-[#0b0d13]/90 px-6 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-widest text-zinc-500 sm:inline">
              {me.role === "company_admin" ? "Admin" : me.role === "hr" ? "HR" : "Employee"}
            </span>
            <span className="hidden text-zinc-700 sm:inline">/</span>
            <span className="truncate text-sm text-zinc-300">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-[#1c2230] px-2.5 py-1 text-[11px] text-zinc-400">
              <span className="size-1.5 rounded-full bg-[#34d399]" /> Operational
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} data-testid="header-sign-out-button" className="md:hidden">
              <LogOut className="size-3.5" />
            </Button>
          </div>
        </header>

        <main className="flex-1 px-6 py-8 lg:px-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-white/95">{title}</h1>
                <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
              </div>
              {actions}
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
