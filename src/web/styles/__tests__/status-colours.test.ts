// The time bar's status colours, checked the way the palette validator checks neighbouring marks: every
// pair of statuses that can sit side by side keeps OKLab distance (x100) of 15 or more for normal vision
// and 8 or more under protanopia and deuteranopia (Machado, Oliveira and Fernandes 2009, severity 1), and
// each colour keeps 3:1 against the card, in both themes.
import { describe, expect, it } from "vitest";
import tokens from "../tokens.css?raw";

const darkStart = tokens.indexOf("@media (prefers-color-scheme: dark)");
const blocks = { light: tokens.slice(0, darkStart), dark: tokens.slice(darkStart) };

function token(theme: "light" | "dark", name: string): string {
  const own = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(blocks[theme])?.[1];
  const value = own ?? new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(blocks.light)?.[1];
  if (!value) throw new Error(`no ${name}`);
  return value;
}

const BAR: Record<string, string> = { queued: "--text-faint", planning: "--status-planning", running: "--info", awaiting_approval: "--warning", paused: "--status-paused", needs_attention: "--status-attention" };
// A pause is refused while awaiting approval, but a resume can derive it, so that pair can touch too.
const NEIGHBOURS: [string, string][] = [
  ["queued", "planning"], ["queued", "paused"], ["queued", "needs_attention"], ["planning", "running"], ["planning", "paused"], ["planning", "needs_attention"],
  ["running", "awaiting_approval"], ["running", "paused"], ["running", "needs_attention"], ["awaiting_approval", "needs_attention"], ["awaiting_approval", "paused"], ["paused", "needs_attention"],
];

const linear = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
const luminance = (hex: string) => {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
} as const;
function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function distance(a: string, b: string, vision?: keyof typeof MACHADO): number {
  const see = (hex: string) => {
    const rgb = linear(hex);
    if (!vision) return oklab(rgb);
    return oklab(MACHADO[vision].map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) as [number, number, number]);
  };
  const [p, q] = [see(a), see(b)];
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

describe("time bar status colours", { tags: ["ui"] }, () => {
  for (const theme of ["light", "dark"] as const) {
    it(`keeps every status that can touch another apart for normal and colour-blind vision, at 3:1 or more on the card (${theme})`, () => {
      const colour = (status: string) => token(theme, BAR[status] as string);
      const surface = token(theme, "--surface");
      for (const status of Object.keys(BAR)) expect([status, contrast(colour(status), surface) >= 3]).toEqual([status, true]);
      for (const [a, b] of NEIGHBOURS) {
        const [x, y] = [colour(a), colour(b)];
        expect([a, b, distance(x, y) >= 15, Math.min(distance(x, y, "protan"), distance(x, y, "deutan")) >= 8]).toEqual([a, b, true, true]);
      }
    });
  }

  it("reads the dark theme's own values for the new steps", () => {
    expect(["--status-planning", "--status-paused", "--status-attention"].map((name) => token("dark", name) !== token("light", name))).toEqual([true, true, true]);
  });
});
