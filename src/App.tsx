import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import AdminShell from "./components/AdminShell";
import { Loading } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { ThemeProvider } from "./lib/ThemeContext";
import { ToastProvider } from "./lib/Toast";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Users from "./pages/Users";
import Artists from "./pages/Artists";
import Verifications from "./pages/Verifications";
import Bookings from "./pages/Bookings";
import Money from "./pages/Money";
import Services from "./pages/Services";
import Reports from "./pages/Reports";
import Reviews from "./pages/Reviews";
import Support from "./pages/Support";
import Settings from "./pages/Settings";
import Audit from "./pages/Audit";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  if (loading) return <Loading text="Checking your access…" />;
  if (!admin) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAdmin><AdminShell /></RequireAdmin>}>
                <Route index element={<Overview />} />
                <Route path="users" element={<Users />} />
                <Route path="artists" element={<Artists />} />
                <Route path="verifications" element={<Verifications />} />
                <Route path="bookings" element={<Bookings />} />
                <Route path="money" element={<Money />} />
                <Route path="services" element={<Services />} />
                <Route path="reports" element={<Reports />} />
                <Route path="reviews" element={<Reviews />} />
                <Route path="support" element={<Support />} />
                <Route path="settings" element={<Settings />} />
                <Route path="audit" element={<Audit />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
