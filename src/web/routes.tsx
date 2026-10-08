import { Route, Routes } from "react-router";
import { Dashboard } from "./pages/Dashboard.tsx";
import { DevLogin } from "./pages/DevLogin.tsx";
import { NotFound } from "./pages/NotFound.tsx";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/dev/login" element={<DevLogin />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
