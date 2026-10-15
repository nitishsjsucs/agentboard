import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateDataset } from "../../src/shared/synth/generator.ts";
import { ROOT } from "../lib/meta.ts";
import { builtConfigProblems } from "./built-config.ts";
import { ACCOUNT, API_TOKEN_VAR, PERSONAS, VERIFY_REFS, environment, environmentProblems, serviceTokenFile, type Environment } from "./env.ts";
import { limitOutcomes, neuronBounds, scrubTailEvent, splitJsonValues, summarizeTail, type TailEvent } from "./measure.ts";
import { accessAppBody, bindingsSql, describeProbe, expectedBindings, findings, oneTimePinOnly, sameInclude, setupPlan, verifyPolicyBody, type Observed } from "./readiness.ts";
import { WRANGLER_CREDENTIAL_VARS, wranglerEnv } from "./wrangler.ts";

const production = environment("production");

function complete(e: Environment): Observed {
  return {
    wrangler: { loggedIn: true, authType: "OAuth Token", accountMatches: true },
    d1: e.d1.map((d) => ({ name: d.name, exists: true, pendingMigrations: [] })),
    queues: e.queues.map((name) => ({ name, exists: true, consumers: [`worker:${e.workerName}`] })),
    peopleRows: 60,
    agentControlRows: 3,
    missingBindings: [],
    worker: { exists: true, secrets: ["INTEGRATION_SIGNING_KEY", "ACCESS_AUD"], version: { id: "v1", message: "agentboard abc measured 0123", tag: "abc" } },
    api: {
      error: null,
      gateway: true,
      policies: { "agentboard-people": true, "agentboard-verify": true },
      serviceTokens: [
        { name: "agentboard-verify-operator", exists: true, localSecret: true, clientId: "a.access" },
        { name: "agentboard-verify-approver", exists: true, localSecret: true, clientId: "b.access" },
      ],
      app: { exists: true, audIsTag: true, policiesAttached: true, oneTimePinOnly: true },
    },
    probe: { status: 302, location: `${ACCOUNT.teamDomain}/cdn-cgi/access/login/${e.hostname}?redirect_url=%2Fapi%2Fhealth`, body: "" },
  };
}

describe("deployed environments", { tags: ["tooling"] }, () => {
  it("wrangler.jsonc's production and preview environments match the account facts and the agentboard prefix", () => {
    const preview = environment("preview");
    expect(production).toMatchObject({
      workerName: "agentboard-production",
      url: "https://agentboard-production.nitish-ratakonda.workers.dev",
      accountId: ACCOUNT.id,
      aiGatewayId: "agentboard",
      d1: [
        { binding: "DB", name: "agentboard" },
        { binding: "PEOPLE_DB", name: "agentboard-people" },
      ],
    });
    expect(production.queues.sort()).toEqual(["agentboard-tasks", "agentboard-tasks-dlq"]);
    expect(preview.workerName).toBe("agentboard-preview");
    expect(preview.queues.sort()).toEqual(["agentboard-preview-tasks", "agentboard-preview-tasks-dlq"]);
    expect(preview.d1.map((d) => d.name)).toEqual(["agentboard-preview", "agentboard-people-preview"]);
    expect(environmentProblems(production)).toEqual([]);
    expect(environmentProblems(preview)).toEqual([]);

    const broken: Environment = { ...production, queues: ["tasks"], vars: { ...production.vars, ACCESS_AUD: "x", ALLOWED_ORIGINS: "https://example.com" } };
    expect(environmentProblems(broken)).toEqual([
      'resource name "tasks" is not prefixed with agentboard',
      "ACCESS_AUD must not be a var (it is a Worker secret set by cf:setup)",
      `ALLOWED_ORIGINS is https://example.com, expected ${production.url}`,
    ]);
  });

  it("the doctor reports everything in place as ready, and names each missing piece with what to run", () => {
    expect(findings(complete(production), production, { ci: false }).filter((f) => !f.ok)).toEqual([]);

    const empty: Observed = {
      wrangler: { loggedIn: true, authType: "OAuth Token", accountMatches: true },
      d1: production.d1.map((d) => ({ name: d.name, exists: false, pendingMigrations: null })),
      queues: production.queues.map((name) => ({ name, exists: false, consumers: [] })),
      peopleRows: null,
      agentControlRows: null,
      missingBindings: null,
      worker: { exists: false, secrets: [], version: null },
      api: null,
      probe: { status: 404, location: null, body: "" },
    };
    const missing = findings(empty, production, { ci: false }).filter((f) => !f.ok);
    expect(missing.map((f) => f.area)).toEqual([
      "D1 agentboard",
      "D1 agentboard-people",
      "queue agentboard-tasks",
      "queue agentboard-tasks-dlq",
      "people seed",
      "agent controls",
      "role bindings",
      "Worker agentboard-production",
      "secret INTEGRATION_SIGNING_KEY",
      "secret ACCESS_AUD",
      "Access and AI Gateway",
      `GET ${production.url}/api/health (no credentials)`,
    ]);
    expect(missing.every((f) => f.fix)).toBe(true);
    expect(missing.find((f) => f.area === "secret ACCESS_AUD")?.detail).toMatch(/fails closed/);

    // CI checks only what the preview deploy needs: no Access token, no seeds, pending migrations are fine.
    const ci = complete(production);
    ci.api = null;
    ci.d1 = ci.d1.map((d) => ({ ...d, pendingMigrations: ["0004_next.sql"] }));
    expect(findings(ci, production, { ci: true }).filter((f) => !f.ok)).toEqual([]);
  });

  it("an unauthenticated request is protected only when it ends at the team's Access login", () => {
    expect(describeProbe({ status: 302, location: `${ACCOUNT.teamDomain}/cdn-cgi/access/login/x`, body: "" }).accessProtected).toBe(true);
    expect(describeProbe({ status: 302, location: "https://evil.example/login", body: "" }).accessProtected).toBe(false);
    expect(describeProbe({ status: 500, location: null, body: '{"error":{"code":"misconfigured"}}' })).toEqual({
      accessProtected: false,
      text: expect.stringContaining("failing closed"),
    });
    expect(describeProbe({ status: 200, location: null, body: "{}" }).accessProtected).toBe(false);
  });

  it("role bindings are upserted idempotently for the personas and the verification tokens' principals", () => {
    const bindings = expectedBindings({ "agentboard-verify-operator": "AbC.access", "agentboard-verify-approver": null });
    expect(bindings.map((b) => [b.principal, b.role])).toEqual([
      ...PERSONAS.map((p) => [p.email, p.role]),
      ["svc:abc.access", "operator"],
    ]);
    const sql = bindingsSql([{ principal: "o'brien@example.com", role: "viewer", displayName: "O'Brien" }], "2026-10-15T00:00:00.000Z");
    expect(sql).toContain("'o''brien@example.com'");
    expect(sql).toContain("WHERE role_bindings.role IS NOT excluded.role");
    expect(sameInclude([{ email: { email: "a" } }, { email: { email: "b" } }], [{ email: { email: "b" } }, { email: { email: "a" } }])).toBe(true);
    expect(verifyPolicyBody(["t1"])).toEqual({ name: "agentboard-verify", decision: "non_identity", include: [{ service_token: { token_id: "t1" } }] });
  });

  it("only the environment's own build may be deployed", () => {
    const good = { path: "dist/agentboard/wrangler.json", name: production.workerName, account_id: ACCOUNT.id, vars: { ENVIRONMENT: "production", AUTH_MODE: "access", FAULT_INJECTION: "off", MCP_EXTERNAL: "off", LLM_PROVIDER: "workers-ai" } };
    expect(builtConfigProblems(good, production)).toEqual([]);
    const local = { ...good, name: "agentboard", vars: { ...good.vars, ENVIRONMENT: "development", AUTH_MODE: "dev", ACCESS_AUD: "agentboard-dev" } };
    expect(builtConfigProblems(local, production)).toEqual([
      "built Worker name is agentboard, expected agentboard-production",
      "built ENVIRONMENT is development, expected production",
      "built AUTH_MODE is dev, expected access",
      "the built config carries ACCESS_AUD as a var, which would collide with the Worker secret",
    ]);
  });

  it("the verification runs are repeatable requests without fault directives", () => {
    const runs = generateDataset().runs.filter((r) => VERIFY_REFS.includes(r.ref));
    expect(runs.map((r) => [r.ref, r.requestType, r.expectedStatus, r.approval?.decision ?? null])).toEqual([
      ["syn-0002", "privileged_access", "rejected", "reject"],
      ["syn-0006", "address_change", "succeeded", null],
      ["syn-0013", "address_change", "succeeded", null],
      ["syn-0022", "manager_change", "succeeded", "approve"],
    ]);
    expect(runs.every((r) => r.modifier === null && !r.sim && !r.budget)).toBe(true);
    expect(new Set(runs.map((r) => r.subjectEmployeeId)).size).toBe(runs.length);
  });
});

describe("credentials and Access", { tags: ["tooling"] }, () => {
  it("wrangler never sees the Access token or any other credential variable, except CI's deploy token", () => {
    const shell = Object.fromEntries([...WRANGLER_CREDENTIAL_VARS.map((name) => [name, "secret-value"]), ["PATH", "/usr/bin"]]);
    // wrangler reads CF_API_TOKEN as a deprecated alias of CLOUDFLARE_API_TOKEN, and the scripts' token lives there.
    expect(API_TOKEN_VAR).toBe("CF_API_TOKEN");
    const local = wranglerEnv(shell, false);
    for (const name of WRANGLER_CREDENTIAL_VARS) expect(local[name]).toBeUndefined();
    expect(local["PATH"]).toBe("/usr/bin");
    const ciEnv = wranglerEnv(shell, true);
    expect(Object.keys(ciEnv).filter((k) => (WRANGLER_CREDENTIAL_VARS as readonly string[]).includes(k))).toEqual(["CLOUDFLARE_API_TOKEN"]);
  });

  it("the service tokens' client secrets live in a gitignored file inside the repository", () => {
    const file = serviceTokenFile();
    expect(file.startsWith(ROOT)).toBe(true);
    // git check-ignore exits 0 only for an ignored path (and throws otherwise).
    expect(() => execFileSync("git", ["check-ignore", "-q", file], { cwd: ROOT, stdio: "ignore" })).not.toThrow();
  });

  it("the Access application allows only the One-time PIN provider and carries both policies in order", () => {
    const body = accessAppBody(production, ["people-id", "verify-id"]);
    expect(body).toMatchObject({
      type: "self_hosted",
      domain: "agentboard-production.nitish-ratakonda.workers.dev",
      allowed_idps: ["743683e8-42d4-44e9-9991-ba57a1bb0dec"],
      auto_redirect_to_identity: true,
      policies: [
        { id: "people-id", precedence: 1 },
        { id: "verify-id", precedence: 2 },
      ],
    });
    expect(oneTimePinOnly({ allowed_idps: [ACCOUNT.oneTimePinIdpId] })).toBe(true);
    expect(oneTimePinOnly({ allowed_idps: [ACCOUNT.oneTimePinIdpId, "github"] })).toBe(false);
    expect(oneTimePinOnly({})).toBe(false);
  });

  it("the dry run plans every step on an empty account, blocks the Access steps without the token, and plans nothing when all is in place", () => {
    const message = "agentboard abc measured 0123";
    const empty: Observed = {
      wrangler: { loggedIn: true, authType: "OAuth Token", accountMatches: true },
      d1: production.d1.map((d) => ({ name: d.name, exists: false, pendingMigrations: null })),
      queues: production.queues.map((name) => ({ name, exists: false, consumers: [] })),
      peopleRows: null,
      agentControlRows: null,
      missingBindings: null,
      worker: { exists: false, secrets: [], version: null },
      api: null,
      probe: { status: 404, location: null, body: "" },
    };
    const withoutToken = setupPlan(empty, production, { token: false, deployMessage: message });
    expect(withoutToken.filter((s) => s.action === "blocked").map((s) => s.step)).toEqual([
      "AI Gateway agentboard",
      "Access service tokens and policies",
      `Access application for ${production.hostname}`,
    ]);
    expect(withoutToken.find((s) => s.step === "deploy agentboard-production")).toMatchObject({ action: "do", detail: expect.stringContaining("INTEGRATION_SIGNING_KEY (generated)") });
    expect(withoutToken.find((s) => s.step.startsWith("Access application"))?.detail).toMatch(/500 misconfigured/);

    const withToken = setupPlan({ ...empty, api: { error: null, gateway: false, policies: { "agentboard-people": false, "agentboard-verify": false }, serviceTokens: [], app: { exists: false, audIsTag: false, policiesAttached: false, oneTimePinOnly: false } } }, production, { token: true, deployMessage: message });
    expect(withToken.filter((s) => s.action === "blocked")).toEqual([]);
    expect(withToken.find((s) => s.step.startsWith("Access application"))?.detail).toMatch(/then redeploy with its AUD tag/);

    const done = complete(production);
    done.worker.version = { id: "v1", message, tag: "abc" };
    expect(setupPlan(done, production, { token: true, deployMessage: message }).filter((s) => s.action !== "ok").map((s) => s.step)).toEqual(["check"]);
  });
});

describe("cf:verify measurements", { tags: ["eval"] }, () => {
  it("parses wrangler tail's pretty-printed JSON and summarizes invocations per kind, including limit outcomes", () => {
    const events: TailEvent[] = [
      { outcome: "ok", executionModel: "stateless", cpuTime: 2, wallTime: 40, event: { request: { url: "https://x/api/runs", method: "GET" } } },
      { outcome: "exceededCpu", executionModel: "stateless", cpuTime: 12, wallTime: 30, event: { request: { url: "https://x/api/runs {braces}", method: "POST" } } },
      { outcome: "ok", executionModel: "durableObject", entrypoint: "PlannerAgent", cpuTime: 25, wallTime: 3000, event: { rpcMethod: "handleTask" } },
      { outcome: "ok", executionModel: "stateless", event: { queue: "agentboard-tasks", batchSize: 2 } },
    ];
    const text = `Connected to agentboard-production\n${events.map((e) => JSON.stringify(e, null, 2)).join("\n")}\ntrailing {not json`;
    const parsed = splitJsonValues(text) as TailEvent[];
    expect(parsed).toEqual(events);
    const summary = summarizeTail(parsed);
    expect(Object.keys(summary)).toEqual(["durable object PlannerAgent rpc", "worker fetch", "worker queue"]);
    expect(summary["worker fetch"]).toMatchObject({ invocations: 2, outcomes: { ok: 1, exceededCpu: 1 }, cpu_ms_max: 12 });
    expect(summary["worker queue"]).toMatchObject({ invocations: 1, cpu_ms_max: null });
    expect(limitOutcomes(summary)).toBe(1);
  });

  it("raw tail events are kept without request headers or cf properties", () => {
    const event: TailEvent = {
      outcome: "ok",
      cpuTime: 1,
      event: { request: { url: "https://x/api/me", method: "GET", headers: { "cf-access-jwt-assertion": "eyJ.secret.jwt", "cf-access-client-secret": "s3cret" }, cf: { colo: "SJC" } } },
    };
    const scrubbed = scrubTailEvent(event);
    expect(scrubbed).toEqual({ outcome: "ok", cpuTime: 1, event: { request: { url: "https://x/api/me", method: "GET" } } });
    expect(JSON.stringify(scrubbed)).not.toMatch(/secret|eyJ/);
    expect(scrubTailEvent({ outcome: "ok", event: { queue: "q" } })).toEqual({ outcome: "ok", event: { queue: "q" } });
  });

  it("bounds Workers AI neurons for the planner model by pricing every token as input or as output", () => {
    expect(neuronBounds(10_000)).toEqual({ low: 46, high: 305 });
    expect(neuronBounds(0)).toEqual({ low: 0, high: 0 });
  });
});
