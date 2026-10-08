import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client.ts";
import { useSession } from "../api/hooks.ts";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (health?.authMode !== "dev") return;
    api
      .get<{ users: DevUser[] }>("/api/dev/users")
      .then((r) => setUsers(r.users))
      .catch((e: Error) => setError(e.message));
  }, [health?.authMode]);

  if (health && health.authMode !== "dev") {
    return <div className="notice">Dev login is only available in local dev mode. This deployment uses Cloudflare Access.</div>;
  }

  const login = async (principal: string) => {
    try {
      await api.post("/api/dev/login", { principal });
      reload();
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
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
      {error ? <div className="notice notice--danger">{error}</div> : null}
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
