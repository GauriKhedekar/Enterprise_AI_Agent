import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import RequireRole from "@/components/RequireRole";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import AcceptInvite from "@/pages/AcceptInvite";
import CompanyDashboard from "@/pages/CompanyDashboard";
import CompanyApiKeys from "@/pages/CompanyApiKeys";
import CompanyEmployees from "@/pages/CompanyEmployees";
import CompanyPolicies from "@/pages/CompanyPolicies";
import EmployeeHome from "@/pages/EmployeeHome";
import EmployeeHistory from "@/pages/EmployeeHistory";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        <Route
          path="/company/dashboard"
          element={<RequireRole role="company_admin">{(me) => <CompanyDashboard me={me} />}</RequireRole>}
        />
        <Route
          path="/company/employees"
          element={<RequireRole role="company_admin">{(me) => <CompanyEmployees me={me} />}</RequireRole>}
        />
        <Route
          path="/company/policies"
          element={<RequireRole role="company_admin">{(me) => <CompanyPolicies me={me} />}</RequireRole>}
        />
        <Route
          path="/company/api-keys"
          element={<RequireRole role="company_admin">{(me) => <CompanyApiKeys me={me} />}</RequireRole>}
        />

        <Route
          path="/employee/home"
          element={<RequireRole role="employee">{(me) => <EmployeeHome me={me} />}</RequireRole>}
        />
        <Route
          path="/employee/history"
          element={<RequireRole role="employee">{(me) => <EmployeeHistory me={me} />}</RequireRole>}
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <Toaster position="top-right" richColors />
    </>
  );
}
