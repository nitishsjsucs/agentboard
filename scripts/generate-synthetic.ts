// npm run synth        writes the dataset, its checksum and the seed SQL
// npm run synth:check  regenerates in memory and fails if any committed byte differs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDataset, renderConsoleSeed, renderPeopleSeed, serializeDataset } from "../src/shared/synth/generator.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");

const dataset = generateDataset();
const json = serializeDataset(dataset);
const outputs: Record<string, string> = {
  "fixtures/synthetic/dataset.v1.json": json,
  "fixtures/synthetic/dataset.v1.sha256": `${createHash("sha256").update(json).digest("hex")}  dataset.v1.json\n`,
  "seed/console.sql": renderConsoleSeed(dataset),
  "seed/people.sql": renderPeopleSeed(dataset),
};

let failed = false;
for (const [relative, contents] of Object.entries(outputs)) {
  const path = `${root}${relative}`;
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    if (current !== contents) {
      console.error(`synth:check: ${relative} differs from the generator output`);
      failed = true;
    }
  } else {
    writeFileSync(path, contents);
    console.log(`wrote ${relative}`);
  }
}
if (check) {
  if (failed) process.exit(1);
  console.log(`synth:check: ${Object.keys(outputs).length} files match (runs: ${dataset.runs.length}, employees: ${dataset.employees.length})`);
}
