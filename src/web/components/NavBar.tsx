import { Link, NavLink } from "react-router";
import { useSession } from "../api/hooks.ts";

const LINKS: { to: string; label: string; permission?: "runs:launch" }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/runs", label: "Runs" },
  { to: "/approvals", label: "Approvals" },
  { to: "/launch", label: "Launch", permission: "runs:launch" },
];

export function NavBar() {
  const { me, health } = useSession();
  return (
    <nav className="nav" aria-label="Primary">
      <Link to="/" className="nav__brand">
        AgentBoard
      </Link>
      <div className="nav__links">
        {LINKS.filter((link) => !link.permission || me?.permissions.includes(link.permission)).map((link) => (
          <NavLink key={link.to} to={link.to} end={link.to === "/"} className={({ isActive }) => `nav__link${isActive ? " active" : ""}`}>
            {link.label}
          </NavLink>
        ))}
      </div>
      <div className="nav__who">
        {health ? <span className={`badge${health.environment === "production" ? " badge--danger" : " badge--info"}`}>{health.environment}</span> : null}
        {me ? (
          <>
            <span className="principal mono">{me.principal.id}</span>
            <span className="badge badge--accent">{me.role ?? "no role"}</span>
          </>
        ) : null}
        {health?.authMode === "dev" ? (
          <Link to="/dev/login" className="small">
            switch user
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
