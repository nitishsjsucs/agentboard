// Test-only bindings, added by vitest.config.ts on top of wrangler.jsonc.
// Both the global `Env` and `Cloudflare.Env` are augmented so production
// classes typed `Agent<Env>` still satisfy the `Cloudflare.Env` constraint.
interface TestOnlyBindings {
  ToolchainProbe: DurableObjectNamespace<import("./probe-agent.ts").ToolchainProbe>;
  TEST_CONSOLE_MIGRATIONS: import("cloudflare:test").D1Migration[];
  TEST_PEOPLE_MIGRATIONS: import("cloudflare:test").D1Migration[];
}
interface Env extends TestOnlyBindings {}
declare namespace Cloudflare {
  interface Env extends TestOnlyBindings {}
}
