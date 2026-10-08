import { describe, expect, it } from "vitest";
import { assertLoopbackArgs } from "./loopback.ts";

describe("loopback launchers", { tags: ["tooling"] }, () => {
  it("the dev server refuses a non-loopback or bare --host and accepts loopback values", () => {
    expect(() => assertLoopbackArgs(["vite", "dev", "--host", "0.0.0.0"], ["--host"])).toThrow(/loopback only/);
    expect(() => assertLoopbackArgs(["vite", "dev", "--host=192.168.1.20"], ["--host"])).toThrow(/loopback only/);
    expect(() => assertLoopbackArgs(["vite", "dev", "--host"], ["--host"])).toThrow(/all interfaces/);
    expect(() => assertLoopbackArgs(["vite", "dev", "--host", "--port", "5173"], ["--host"])).toThrow(/all interfaces/);
    expect(() => assertLoopbackArgs(["vite", "dev", "--host", "127.0.0.1"], ["--host"])).not.toThrow();
    expect(() => assertLoopbackArgs(["vite", "dev", "--host=localhost"], ["--host"])).not.toThrow();
    expect(() => assertLoopbackArgs(["vite", "dev"], ["--host"])).not.toThrow();
  });

  it("the built-worker launcher refuses a non-loopback --ip", () => {
    expect(() => assertLoopbackArgs(["wrangler", "dev", "--ip", "0.0.0.0"], ["--ip"])).toThrow(/loopback only/);
    expect(() => assertLoopbackArgs(["wrangler", "dev", "--ip=10.0.0.5"], ["--ip"])).toThrow(/loopback only/);
    expect(() => assertLoopbackArgs(["wrangler", "dev", "--ip", "[::1]"], ["--ip"])).not.toThrow();
    expect(() => assertLoopbackArgs(["wrangler", "dev", "--ip", "127.0.0.1", "--port", "8784"], ["--ip"])).not.toThrow();
  });
});
