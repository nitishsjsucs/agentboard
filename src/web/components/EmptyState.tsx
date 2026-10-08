import type { ReactNode } from "react";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600 }}>{title}</div>
      {children ? <div className="small">{children}</div> : null}
    </div>
  );
}
