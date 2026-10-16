import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRolesResponse } from "../../../shared/api-types.ts";
import { apiError, reply, stubApi, type SeenRequest } from "../../components/__tests__/api.ts";
import { DEV_HEALTH, renderAt } from "../../components/__tests__/session.tsx";
import { Launch } from "../Launch.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EMPLOYEES = [
  { id: "E-1007", fullName: "Halia Elsworth", department: "Finance", employmentStatus: "active" },
  { id: "E-1017", fullName: "Rosalind Galloway", department: "Support", employmentStatus: "active" },
];
const SAMPLES = [
  { ref: "syn-0022", requestType: "manager_change", subjectEmployeeId: "E-1017", requestText: "Reorg: move E-1017 under manager E-1004. Notify them by Slack when done." },
];
const TEXT = "Please update the home address for E-1007 to 12 Elm Street, Austin.";

function serve(options: { launch?: (request: SeenRequest) => Response | Promise<Response>; roles?: AgentRolesResponse["roles"] } = {}) {
  return stubApi((request) => {
    const { method, path } = request;
    if (path === "/api/people/directory") return reply({ employees: EMPLOYEES });
    if (path === "/api/dev/samples") return reply({ samples: SAMPLES });
    if (path === "/api/agents") return reply({ roles: options.roles ?? [] });
    if (path === "/api/runs" && method === "POST") return options.launch ? options.launch(request) : reply({ runId: "run_new", status: "queued", deduplicated: false }, 201);
    return undefined;
  });
}

const page = (role: "operator" | "admin" | "approver" | "viewer" = "operator", health = DEV_HEALTH) => render(renderAt(role, <Launch />, { url: "/launch", path: "/launch", health }));
const launchButton = () => screen.getByRole("button", { name: "Launch run" }) as HTMLButtonElement;
const posts = (seen: SeenRequest[]) => seen.filter((s) => s.method === "POST" && s.path === "/api/runs");

async function fillValidForm() {
  await screen.findByRole("option", { name: /Halia Elsworth/ });
  fireEvent.change(screen.getByLabelText("Subject employee"), { target: { value: "E-1007" } });
  fireEvent.change(screen.getByLabelText("Request text"), { target: { value: TEXT } });
}

describe("Launch layout", { tags: ["ui"] }, () => {
  it("puts both field rows in form-two grids with no inline column template, so they stack on narrow screens", async () => {
    serve();
    page();
    await screen.findByRole("option", { name: /Halia Elsworth/ });
    const typeRow = screen.getByLabelText("Request type").closest(".field")?.parentElement as HTMLElement;
    const priorityRow = screen.getByLabelText("Priority").closest(".field")?.parentElement as HTMLElement;
    for (const row of [typeRow, priorityRow]) {
      expect(row.classList.contains("form-two")).toBe(true);
      expect(row.style.gridTemplateColumns).toBe("");
    }
  });
});

describe("Launch form guidance", { tags: ["ui"] }, () => {
  it("says why Launch run is disabled, in a hint the button points to, until the form is valid", async () => {
    serve();
    page();
    await screen.findByRole("option", { name: /Halia Elsworth/ });
    expect(launchButton().disabled).toBe(true);
    expect(launchButton().getAttribute("aria-describedby")).toBe("launch-hint");
    const hint = () => document.getElementById("launch-hint")?.textContent ?? "";
    expect(hint()).toContain("Choose a subject employee.");
    expect(hint()).toContain("Request text needs at least 10 characters (0 of 10).");

    fireEvent.change(screen.getByLabelText("Subject employee"), { target: { value: "E-1007" } });
    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: "  short  " } });
    expect(hint()).not.toContain("Choose a subject employee.");
    expect(hint()).toContain("(5 of 10)");

    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: TEXT } });
    expect(document.getElementById("launch-hint")).toBeNull();
    expect(launchButton().getAttribute("aria-describedby")).toBeNull();
    expect(launchButton().disabled).toBe(false);
  });

  it("clears the subject and text (and resets the type) when the sample placeholder is chosen again", async () => {
    serve();
    page();
    const sample = (await screen.findByLabelText("Sample request (dev only)")) as HTMLSelectElement;
    await screen.findByRole("option", { name: /syn-0022/ });
    fireEvent.change(sample, { target: { value: "syn-0022" } });
    expect((screen.getByLabelText("Subject employee") as HTMLSelectElement).value).toBe("E-1017");
    expect((screen.getByLabelText("Request type") as HTMLSelectElement).value).toBe("manager_change");
    fireEvent.change(sample, { target: { value: "" } });
    expect((screen.getByLabelText("Subject employee") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Request text") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("Request type") as HTMLSelectElement).value).toBe("address_change");
  });

  it("warns, without blocking, that the stub planner will not plan typed text that matches no sample", async () => {
    serve();
    page();
    await screen.findByRole("option", { name: /syn-0022/ });
    fireEvent.change(screen.getByLabelText("Sample request (dev only)"), { target: { value: "syn-0022" } });
    expect(screen.queryByTestId("stub-warning")).toBeNull();

    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: `${SAMPLES[0]?.requestText} Thanks!` } });
    expect(screen.getByTestId("stub-warning").textContent).toBe(
      "The local stub planner only plans the sample requests exactly. This request will probably fail planning and need attention.",
    );
    expect(launchButton().disabled).toBe(false);
  });

  it("shows no stub warning when the planner is a real model", async () => {
    serve();
    page("operator", { ...DEV_HEALTH, llmProvider: "openai-compatible" });
    await fillValidForm();
    expect(screen.queryByTestId("stub-warning")).toBeNull();
  });
});

describe("Launch submits", { tags: ["ui"] }, () => {
  it("after a lost answer, Try again resends the identical body with the same key, and a deduplicated answer opens the run", async () => {
    let attempt = 0;
    const api = serve({
      launch: () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return reply({ runId: "run_first", status: "queued", deduplicated: true });
      },
    });
    page();
    await fillValidForm();
    fireEvent.click(launchButton());
    expect((await screen.findByTestId("launch-unanswered")).textContent).toContain("The launch may not have reached AgentBoard.");
    expect((screen.getByLabelText("Request text") as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByLabelText("Subject employee") as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs/run_first"));
    const [first, second] = posts(api.seen);
    expect(second?.rawBody).toBe(first?.rawBody);
    expect((first?.body as { clientRequestId: string }).clientRequestId).toMatch(/^web-/);
  });

  it("Edit request after a lost answer unlocks the fields and keeps the key, so an edit of a launch that never arrived is created under it", async () => {
    let attempt = 0;
    const api = serve({
      launch: () => {
        attempt += 1;
        if (attempt === 1) return new Response("<html>gateway</html>", { status: 502 });
        return reply({ runId: "run_edited", status: "queued", deduplicated: false }, 201);
      },
    });
    page();
    await fillValidForm();
    fireEvent.click(launchButton());
    expect((await screen.findByTestId("launch-unanswered")).textContent).toContain("Try again and Edit request both keep this form's key, so neither can start a second run.");
    fireEvent.click(screen.getByRole("button", { name: "Edit request" }));
    expect((screen.getByLabelText("Request text") as HTMLTextAreaElement).readOnly).toBe(false);
    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: `${TEXT} Effective Monday.` } });
    fireEvent.click(launchButton());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs/run_edited"));
    const [first, second] = posts(api.seen).map((p) => (p.body as { clientRequestId: string }).clientRequestId);
    expect(second).toBe(first);
  });

  it("when the lost launch did arrive, the edited request is refused as a conflict with Runs and Start a new request, not run twice", async () => {
    // The server's per-requester reservation: the first body landed, but its answer was lost.
    const reserved = new Map<string, string>();
    const api = serve({
      launch: ({ body, rawBody }) => {
        const { clientRequestId } = body as { clientRequestId: string };
        const previous = reserved.get(clientRequestId);
        if (previous === undefined) {
          reserved.set(clientRequestId, rawBody ?? "");
          if (reserved.size === 1) throw new TypeError("Failed to fetch");
          return reply({ runId: "run_new_key", status: "queued", deduplicated: false }, 201);
        }
        if (previous !== rawBody) return apiError(409, "conflict", "clientRequestId was used with a different request", "idempotency_conflict");
        return reply({ runId: "run_landed", status: "queued", deduplicated: true });
      },
    });
    page();
    await fillValidForm();
    fireEvent.click(launchButton());
    fireEvent.click(await screen.findByRole("button", { name: "Edit request" }));
    fireEvent.change(screen.getByLabelText("Request text"), { target: { value: `${TEXT} Thanks.` } });
    fireEvent.click(launchButton());
    const conflict = await screen.findByTestId("launch-conflict");
    expect(conflict.textContent).toContain("This form already launched a different request. Check Runs for it, or start a new request.");
    expect(screen.getByTestId("location").textContent).toBe("/launch");
    expect(reserved.size).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Start a new request" }));
    fireEvent.click(launchButton());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs/run_new_key"));
    const keys = posts(api.seen).map((p) => (p.body as { clientRequestId: string }).clientRequestId);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("explains an idempotency conflict with a link to Runs, and Start a new request mints a new key", async () => {
    let attempt = 0;
    const api = serve({
      launch: () => {
        attempt += 1;
        if (attempt === 1) return apiError(409, "conflict", "clientRequestId was used with a different request", "idempotency_conflict");
        return reply({ runId: "run_second", status: "queued", deduplicated: false }, 201);
      },
    });
    page();
    await fillValidForm();
    fireEvent.click(launchButton());
    const conflict = await screen.findByTestId("launch-conflict");
    expect(conflict.textContent).toContain("This form already launched a different request. Check Runs for it, or start a new request.");
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("href")).toBe("/runs");
    expect(document.body.textContent).not.toContain("clientRequestId");

    fireEvent.click(screen.getByRole("button", { name: "Start a new request" }));
    fireEvent.click(launchButton());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs/run_second"));
    const [first, second] = posts(api.seen).map((p) => (p.body as { clientRequestId: string }).clientRequestId);
    expect(second).not.toBe(first);
  });

  it("sends one key for the same unedited form submitted twice", async () => {
    let attempt = 0;
    const api = serve({
      launch: () => {
        attempt += 1;
        if (attempt === 1) return apiError(500, "internal", "internal error");
        return reply({ runId: "run_same", status: "queued", deduplicated: true });
      },
    });
    page();
    await fillValidForm();
    fireEvent.click(launchButton());
    expect((await screen.findByRole("alert")).textContent).toContain("AgentBoard could not finish this request.");
    fireEvent.click(launchButton());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/runs/run_same"));
    const keys = posts(api.seen).map((p) => (p.body as { clientRequestId: string }).clientRequestId);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("Launch for roles and agents", { tags: ["ui"] }, () => {
  it("tells a role without runs:launch it cannot launch, with links onward, and requests nothing", async () => {
    const api = serve();
    page("approver");
    expect(screen.getByTestId("cannot-launch").textContent).toContain("Your role (approver) cannot launch runs.");
    expect(screen.getByRole("link", { name: "Runs" }).getAttribute("href")).toBe("/runs");
    expect(screen.getByRole("link", { name: "Approvals" }).getAttribute("href")).toBe("/approvals");
    expect(screen.queryByLabelText("Request text")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.paths()).toEqual([]);
  });

  it("says when an agent role is disabled, with its reason and who disabled it", async () => {
    serve({
      roles: [
        { role: "planner", disabled: false, reason: null, updatedBy: "seed", updatedAt: "2026-10-01T00:00:00.000Z", heldTasks: 0 },
        { role: "executor", disabled: true, reason: "executor bug in notify", updatedBy: "admin@agentboard.test", updatedAt: "2026-10-15T12:00:00.000Z", heldTasks: 2 },
      ],
    });
    page();
    expect((await screen.findByTestId("disabled-role")).textContent).toBe(
      "The executor role is disabled (executor bug in notify, by admin@agentboard.test). New runs will wait until an admin enables it.",
    );
  });
});
