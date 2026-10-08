import { readFileSync } from "node:fs";

/** Parses a .dev.vars file (KEY=value lines; values are not quoted by dev-keys). */
export function readDevVars(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index > 0) out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}
