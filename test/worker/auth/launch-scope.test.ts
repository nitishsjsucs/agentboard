import { describe, expect, it } from "vitest";
import type { LaunchRunResponse } from "../../../src/shared/api-types.ts";
import { apiPost, json } from "../../helpers/api.ts";
import { P } from "../../helpers/auth.ts";
import { settleRuns } from "../../helpers/runs.ts";

describe("launch key scope", { tags: ["authz"] }, () => {
  it("a second requester reusing the first requester's clientRequestId gets a new run, never the first requester's run", async () => {
    const body = { clientRequestId: "shared-client-key-0001", requestType: "address_change", requestText: "Please update the address on file for this employee.", subjectEmployeeId: "E-1021" };
    const first = await apiPost(P.operator, "/api/runs", body);
    expect(first.status).toBe(201);
    const firstRun = await json<LaunchRunResponse>(first);
    const second = await apiPost(P.operator2, "/api/runs", body);
    expect(second.status).toBe(201);
    const secondRun = await json<LaunchRunResponse>(second);
    expect(secondRun.runId).not.toBe(firstRun.runId);
    expect(secondRun.deduplicated).toBe(false);
    // The first requester repeating the request gets their own run back.
    const again = await apiPost(P.operator, "/api/runs", body);
    expect(again.status).toBe(200);
    expect(await json<LaunchRunResponse>(again)).toMatchObject({ runId: firstRun.runId, deduplicated: true });
    // Both runs were really launched; let their planner work finish before the file ends.
    await settleRuns([firstRun.runId, secondRun.runId]);
  });
});
