import { Route, Routes } from "react-router";
import { Dashboard } from "./pages/Dashboard.tsx";
import { DevLogin } from "./pages/DevLogin.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { RunDetail } from "./pages/RunDetail.tsx";
import { Runs } from "./pages/Runs.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/runs" element={<Runs />} />
      <Route path="/runs/:id" element={<RunDetail />} />
      <Route path="/dev/login" element={<DevLogin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
