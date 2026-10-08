import { describe, expect, it } from "vitest";
import type { AuditEventView, Page, RunDetailResponse, ToolCallView } from "../../../src/shared/api-types.ts";
import { distinctRuns, driveAgents, inputFromDataset } from "../../helpers/agents.ts";
import { apiGet, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { startManualRun } from "../../helpers/runs.ts";

describe("redaction", { tags: ["authz"] }, () => {
  it("a viewer gets masked addresses and personal emails in tool-call args, results and run detail; audit detail holds no raw address for any role; an operator gets full values", async () => {
    const [run] = distinctRuns("address_change", 1);
    if (!run || !run.fields.address) throw new Error("no dataset run");
    const address = run.fields.address;
    const { runId, stub } = await startManualRun(inputFromDataset(run, { requester: P.operator }));
    await driveAgents(stub);

    // Viewer: run detail.
    const viewerDetail = await json<RunDetailResponse>(await apiGet(P.viewer, `/api/runs/${runId}`));
    expect(viewerDetail.run.requestText).toBeNull();
    const viewerWrite = viewerDetail.tasks.find((t) => t.kind === "execute" && t.tool === "hris.update_address");
    expect(viewerWrite?.args?.["address"]).toEqual({ city: address.city, region: address.region, country: address.country });
    // Viewer: tool calls (the write's args and the HRIS read's result).
    const viewerCalls = await json<Page<ToolCallView>>(await apiGet(P.viewer, `/api/runs/${runId}/tool-calls`));
    const write = viewerCalls.items.find((c) => c.tool === "hris.update_address");
    expect((write?.args as { address: unknown }).address).toEqual({ city: address.city, region: address.region, country: address.country });
    const read = viewerCalls.items.find((c) => c.tool === "hris.get_employee" && c.agent.startsWith("executor"));
    const employee = (read?.result as { employee: { personalEmail: string; address: Record<string, unknown> } }).employee;
    expect(employee.personalEmail).toMatch(/^[a-z]\*\*\*@example\.test$/);
    expect(Object.keys(employee.address).sort()).toEqual(["city", "country", "region"]);
    const viewerText = JSON.stringify([viewerDetail, viewerCalls]);
    expect(viewerText).not.toContain(address.line1);
    expect(viewerText).not.toContain(address.postalCode);

    // Operator (pii:read): full values.
    const operatorDetail = await json<RunDetailResponse>(await apiGet(P.operator, `/api/runs/${runId}`));
    expect(operatorDetail.run.requestText).toBe(run.requestText);
    expect(operatorDetail.tasks.find((t) => t.tool === "hris.update_address" && t.kind === "execute")?.args?.["address"]).toEqual(address);
    const operatorCalls = await json<Page<ToolCallView>>(await apiGet(P.operator, `/api/runs/${runId}/tool-calls`));
    const fullRead = operatorCalls.items.find((c) => c.tool === "hris.get_employee" && c.agent.startsWith("executor"));
    expect((fullRead?.result as { employee: { personalEmail: string } }).employee.personalEmail).toMatch(/^[a-z]+\d+@example\.test$/);

    // Audit detail is redacted at write time, for every role, including admins.
    for (const principal of [P.viewer, P.admin]) {
      const audit = await json<{ events: AuditEventView[]; chain: { valid: boolean } }>(await apiGet(principal, `/api/runs/${runId}/audit`));
      expect(audit.chain.valid).toBe(true);
      const text = JSON.stringify(audit.events);
      expect(text).not.toContain(address.line1);
      expect(text).not.toContain(address.postalCode);
      expect(text).not.toMatch(/[a-z]+\d+@example\.test/);
    }
  });
});

