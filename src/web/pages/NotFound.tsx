import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";

export function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link to="/">Back to the dashboard</Link>
    </EmptyState>
  );
}
