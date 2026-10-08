import type { ReactNode } from "react";
import type { Permission } from "../../shared/domain.ts";
import { useCan } from "../api/hooks.ts";

/** Hides controls the principal lacks the permission for. The server enforces every permission anyway. */
export function RoleGate({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
