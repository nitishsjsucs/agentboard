// Search documents (SPEC section 6.1): PII-free bodies for runs, tasks, tool
// calls and approvals, upserted by the coordinator's outbox flush. No request
// text, addresses or personal emails are ever indexed.

import type { D1Statement } from "../agents/coordinator/outbox.ts";
import type { ApprovalRecord, RunRecord, TaskRecord, ToolCallTrace } from "../agents/coordinator/schema.ts";

const UPSERT = `INSERT INTO search_docs (doc_id, run_id, doc_type, status, request_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(doc_id) DO UPDATE SET status = excluded.status, body = excluded.body`;

const words = (value: string | null | undefined): string => (value ?? "").replaceAll("_", " ").replaceAll(".", " ");
const iso = (ms: number): string => new Date(ms).toISOString();

export function runDoc(run: RunRecord): D1Statement {
  const r = run.request;
  const body = [r.title, words(r.requestType), r.subjectEmployeeId, r.requester, `status ${words(run.status)}`, words(run.statusReason)].filter(Boolean).join("\n");
  return { sql: UPSERT, params: [`run:${run.id}`, run.id, "run", run.status, r.requestType, body, iso(run.createdAt)] };
}

export function taskDoc(run: RunRecord, task: TaskRecord): D1Statement {
  const body = [`${task.kind} task`, task.stepId, task.tool, words(task.tool), `status ${words(task.status)}`, words(task.lastError), words(task.holdReason)]
    .filter(Boolean)
    .join("\n");
  return { sql: UPSERT, params: [`task:${task.id}`, run.id, "task", task.status, run.request.requestType, body, iso(task.createdAt)] };
}

export function toolCallDoc(run: RunRecord, trace: ToolCallTrace): D1Statement {
  const body = [trace.tool, words(trace.tool), `outcome ${words(trace.outcome)}`, trace.agent, trace.stepId, trace.error].filter(Boolean).join("\n");
  return { sql: UPSERT, params: [`call:${trace.id}`, run.id, "tool_call", trace.outcome, run.request.requestType, body, iso(trace.startedAt)] };
}

export function approvalDoc(run: RunRecord, approval: ApprovalRecord): D1Statement {
  const body = [approval.summary, approval.tool, words(approval.tool), `risk ${approval.risk}`, `approval ${approval.status}`, approval.note].filter(Boolean).join("\n");
  return { sql: UPSERT, params: [`approval:${approval.id}`, run.id, "approval", approval.status, run.request.requestType, body, iso(approval.requestedAt)] };
}
