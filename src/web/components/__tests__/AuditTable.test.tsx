import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEventView } from "../../../shared/api-types.ts";
import { AuditTable } from "../AuditTable.tsx";

afterEach(cleanup);

const event = (seq: number, action: string, hash: string): AuditEventView => ({
  stream: "run:run_01J00000000000000000000000",
  seq,
  ts: `2026-10-08T12:00:0${seq}.000Z`,
  actorType: "agent",
  actorId: "executor-1",
  action,
  runId: "run_01J00000000000000000000000",
  taskId: null,
  detail: {},
  prevHash: "0".repeat(64),
  hash,
});

const events = [event(1, "run.created", "a".repeat(64)), event(2, "task.dispatched", "b1c2d3e4f5a6".padEnd(64, "9"))];

describe("AuditTable", { tags: ["ui"] }, () => {
  it("states a verified chain with its length, or the seq where it breaks, and shortens hashes", () => {
    const valid = render(<AuditTable events={events} chain={{ valid: true, brokenAtSeq: null }} />);
    const ok = screen.getByText("Hash chain verified: 2 events, each linked to the previous one by SHA-256.");
    expect(ok.className).toBe("notice");
    const hashCell = screen.getByText("b1c2d3e4f5a6");
    expect(hashCell.getAttribute("title")).toBe("b1c2d3e4f5a6".padEnd(64, "9"));
    valid.unmount();

    render(<AuditTable events={events} chain={{ valid: false, brokenAtSeq: 2 }} />);
    const broken = screen.getByText("Hash chain broken at seq 2.");
    expect(broken.className).toBe("notice notice--danger");
    expect(screen.queryByText(/Hash chain verified/)).toBeNull();
  });
});
