import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./components/home";
import Settings from "./components/settings/Settings";
import CommissionCalculator from "./components/commissions/CommissionCalculator";
import Reports from "./components/reports/Reports";
import CashManagement from "./components/cash-management/CashManagement";
import BitstopCommissions from "./components/bitstop/BitstopCommissions";

function App() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/commissions" element={<CommissionCalculator />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/cash-management" element={<CashManagement />} />
          <Route path="/bitstop-commissions" element={<BitstopCommissions />} />
        </Routes>
      </>
    </Suspense>
  );
}

export default App;
