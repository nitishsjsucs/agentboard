import type { ReactNode } from "react";
import { useSession } from "../api/hooks.ts";
import { NavBar } from "./NavBar.tsx";

export function AppShell({ children }: { children: ReactNode }) {
  const { health } = useSession();
  return (
    <>
      <NavBar />
      {health?.faultInjection ? (
        <div className="notice notice--warning" style={{ borderRadius: 0, textAlign: "center" }}>
          Simulation mode: fault injection is on. The People systems and every employee are simulated.
        </div>
      ) : null}
      <main className="main">{children}</main>
    </>
  );
}
