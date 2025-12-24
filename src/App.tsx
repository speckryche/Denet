import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Login from "./components/auth/Login";
import Home from "./components/home";
import Settings from "./components/settings/Settings";
import CommissionCalculator from "./components/commissions/CommissionCalculator";
import Reports from "./components/reports/Reports";
import CashManagement from "./components/cash-management/CashManagement";
import BitstopCommissions from "./components/bitstop/BitstopCommissions";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/commissions"
            element={
              <ProtectedRoute>
                <CommissionCalculator />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cash-management"
            element={
              <ProtectedRoute>
                <CashManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bitstop-commissions"
            element={
              <ProtectedRoute>
                <BitstopCommissions />
              </ProtectedRoute>
            }
          />
        </Routes>
      </>
    </Suspense>
  );
}

export default App;
