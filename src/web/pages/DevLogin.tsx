import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client.ts";
import { useSession } from "../api/hooks.ts";
import { ErrorNotice } from "../components/ErrorNotice.tsx";

interface DevUser {
  principal: string;
  role: string;
  displayName: string;
}

/** Dev login (loopback dev mode only): pick a seeded principal; the server signs a local JWT cookie. */
export function DevLogin() {
  const { health, reload } = useSession();
  const navigate = useNavigate();
  const [users, setUsers] = useState<DevUser[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (health?.authMode !== "dev") return;
    api
      .get<{ users: DevUser[] }>("/api/dev/users")
      .then((r) => setUsers(r.users))
      .catch((e: unknown) => setError(e));
  }, [health?.authMode]);

  if (health && health.authMode !== "dev") {
    return <div className="notice">Dev login is only available in local dev mode. This deployment uses Cloudflare Access.</div>;
  }

  const login = async (principal: string) => {
    try {
      await api.post("/api/dev/login", { principal });
      // Wait for the new principal's permissions, so the dashboard never fetches with the previous one's.
      await reload();
      navigate("/");
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Dev login</h1>
          <p>Local development only. Pick a seeded principal; the worker signs a 12-hour JWT with the local dev key.</p>
        </div>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      <div className="login-list">
        {users.map((user) => (
          <button key={user.principal} type="button" className="login-option" onClick={() => void login(user.principal)}>
            <div style={{ fontWeight: 600 }}>{user.displayName}</div>
            <div className="mono small muted">{user.principal}</div>
            <span className="badge badge--accent">{user.role}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
