import { useSession } from "../api/hooks.ts";

export function Dashboard() {
  const { me } = useSession();
  return (
    <div className="page-header">
      <div>
        <h1>Dashboard</h1>
        <p>Signed in as {me?.principal.id ?? "nobody"}.</p>
      </div>
    </div>
  );
}
