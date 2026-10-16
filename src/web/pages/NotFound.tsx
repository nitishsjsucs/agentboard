import { Link } from "react-router";
import { usePageTitle } from "../api/usePageTitle.ts";
import { EmptyState } from "../components/EmptyState.tsx";

export function NotFound() {
  usePageTitle("Page not found");
  return (
    <EmptyState title="Page not found">
      <Link to="/">Back to the dashboard</Link>
    </EmptyState>
  );
}
