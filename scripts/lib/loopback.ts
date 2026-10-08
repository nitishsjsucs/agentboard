// The dev servers must never listen on a public interface: dev login trusts
// loopback hostnames, and a Host header is spoofable off-loopback (SPEC section 10.3).

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(value: string): boolean {
  return LOOPBACK.has(value.trim().toLowerCase());
}

/**
 * Throws if argv sets any of `flags` (for example `--host` or `--ip`) to a
 * non-loopback value. A bare `--host` (Vite: listen on every interface) is refused too.
 */
export function assertLoopbackArgs(argv: readonly string[], flags: readonly string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    for (const flag of flags) {
      let value: string | undefined;
      if (arg === flag) {
        const next = argv[i + 1];
        value = next === undefined || next.startsWith("-") ? "" : next;
      } else if (arg.startsWith(`${flag}=`)) {
        value = arg.slice(flag.length + 1);
      } else {
        continue;
      }
      if (!isLoopbackHost(value)) {
        throw new Error(`refusing ${flag} ${value === "" ? "(all interfaces)" : value}: AgentBoard dev servers bind loopback only`);
      }
    }
  }
}
