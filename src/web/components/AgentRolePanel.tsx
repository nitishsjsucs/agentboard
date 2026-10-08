import { useState } from "react";
import type { AgentRolesResponse } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { RoleGate } from "./RoleGate.tsx";
import { formatTime } from "./RunTable.tsx";

export function AgentRolePanel({ roles, onChange }: { roles: AgentRolesResponse["roles"]; onChange: () => void }) {
  const [pending, setPending] = useState<{ role: string; disable: boolean } | null>(null);
  return (
    <div className="card">
      <div className="card__header">
        <h3>Agent roles</h3>
        <span className="small muted">planner calls a model; executor and verifier are deterministic</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>State</th>
              <th>Held tasks</th>
              <th>Last change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.role}>
                <td style={{ fontWeight: 600 }}>{role.role}</td>
                <td>
                  {role.disabled ? <span className="badge badge--danger">disabled</span> : <span className="badge badge--success">enabled</span>}
                  {role.reason ? <div className="faint small">{role.reason}</div> : null}
                </td>
                <td>{role.heldTasks}</td>
                <td className="small muted">
                  {role.updatedBy} {formatTime(role.updatedAt)}
                </td>
                <td>
                  <RoleGate permission="agents:toggle">
                    <button type="button" className={`btn btn--small${role.disabled ? "" : " btn--danger"}`} onClick={() => setPending({ role: role.role, disable: !role.disabled })}>
                      {role.disabled ? "Enable" : "Disable"}
                    </button>
                  </RoleGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending ? (
        <ConfirmDialog
          title={`${pending.disable ? "Disable" : "Enable"} the ${pending.role} role`}
          confirmLabel={pending.disable ? "Disable" : "Enable"}
          danger={pending.disable}
          onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            await api.post(`/api/agents/${pending.role}/${pending.disable ? "disable" : "enable"}`, { reason });
            setPending(null);
            onChange();
          }}
        >
          <p className="small muted">
            {pending.disable
              ? "In-flight leases finish; new messages for this role are held at their coordinator until it is enabled."
              : "Held tasks are released and dispatched again."}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
