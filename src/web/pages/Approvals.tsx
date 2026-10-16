import { useState } from "react";
import type { ApprovalListItem, Page } from "../../shared/api-types.ts";
import { api, query } from "../api/client.ts";
import { usePolling } from "../api/hooks.ts";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PolledView } from "../components/PolledView.tsx";

const STATUSES = ["pending", "approved", "rejected", "expired", ""] as const;

export function Approvals() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  // Switching the status tab clears the previous tab's cards before the new answer arrives.
  const approvals = usePolling(() => api.get<Page<ApprovalListItem>>(`/api/approvals${query({ status, limit: 50 })}`), [status], { resetKey: status });
  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1>Approval queue</h1>
          <p>Manager changes, terminations and privileged grants wait here. Only reads ran before each gate, so a rejection never leaves a write behind.</p>
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 0 }}>
          {STATUSES.map((s) => (
            <button key={s || "all"} type="button" role="tab" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
              {s || "all"}
            </button>
          ))}
        </div>
      </div>
      <PolledView polled={approvals} loading="Loading approvals..." action="read approvals">
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState title={status ? `No ${status} approvals.` : "No approvals yet."} />
          ) : (
            <div className="stack">
              {page.items.map((approval) => (
                <ApprovalCard key={approval.id} approval={approval} onDecided={approvals.refresh} />
              ))}
            </div>
          )
        }
      </PolledView>
    </div>
  );
}
