import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkProvenance, commitCitations, commitProvenance, gitIn, type Git } from "./provenance.ts";

const PATHS = ["src", "package.json"];
const dirs: string[] = [];

interface Repo {
  dir: string;
  git: Git;
  commit(files: Record<string, string>, message: string, authorDate: string): string;
}

function repo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "agentboard-provenance-"));
  dirs.push(dir);
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  run(["init", "-q", "-b", "main"]);
  return {
    dir,
    git: gitIn(dir),
    commit(files, message, authorDate) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      run(["add", "-A"]);
      // The committer date differs between the working and the published copy, as it may in the publish step.
      run(["commit", "-q", "--allow-empty", "-m", message], { GIT_AUTHOR_DATE: authorDate, GIT_COMMITTER_DATE: new Date().toISOString() });
      return run(["rev-parse", "HEAD"]);
    },
  };
}

const TRAILER = "\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
const history: [Record<string, string>, string, string][] = [
  [{ "src/a.ts": "export const a = 1;\n", "package.json": "{}\n", "README.md": "v1\n" }, "feat: a", "2026-10-01T10:00:00Z"],
  [{ "src/a.ts": "export const a = 2;\n" }, "fix: a", "2026-10-01T11:00:00Z"],
  [{ "README.md": "results\n" }, "docs: results", "2026-10-01T12:00:00Z"],
];

/** The working repository (messages with the trailer) and its published copy (without), with equal trees. */
function workingAndPublished() {
  const working = repo();
  const published = repo();
  const workingShas = history.map(([files, message, date]) => working.commit(files, message + TRAILER, date));
  const publishedShas = history.map(([files, message, date]) => published.commit(files, message, date));
  return { working, published, workingShas, publishedShas };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("results provenance", { tags: ["eval"] }, () => {
  it("passes in the working history and on the published copy, whether or not the cited commit id was rewritten", () => {
    const { working, published, workingShas, publishedShas } = workingAndPublished();
    expect(workingShas[1]).not.toBe(publishedShas[1]);
    const meta = { ...commitProvenance(working.git, workingShas[1] as string, PATHS), dirty: false };
    expect(meta.commitDate).toBe("2026-10-01T11:00:00.000Z");
    expect(meta.measuredTree).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(checkProvenance(working.git, "r.json", meta, PATHS)).toEqual({ problems: [], notes: [] });

    // Not rewritten: the working id is absent from the published history; the copy is found.
    const unrewritten = checkProvenance(published.git, "r.json", meta, PATHS);
    expect(unrewritten.problems).toEqual([]);
    expect(unrewritten.notes).toEqual([expect.stringContaining(`its copy here is ${(publishedShas[1] as string).slice(0, 7)}`)]);

    // Rewritten to the published id.
    expect(checkProvenance(published.git, "r.json", { ...meta, gitSha: publishedShas[1] as string }, PATHS)).toEqual({ problems: [], notes: [] });
  });

  it("fails when the measured code changed, the tree was dirty, or the provenance is missing", () => {
    const { published, working, workingShas } = workingAndPublished();
    const meta = { ...commitProvenance(working.git, workingShas[1] as string, PATHS), dirty: false };
    published.commit({ "src/a.ts": "export const a = 3;\n" }, "fix: a again", "2026-10-02T10:00:00Z");
    expect(checkProvenance(published.git, "r.json", meta, PATHS).problems).toEqual([expect.stringContaining("measured code changed since")]);

    expect(checkProvenance(working.git, "r.json", { ...meta, dirty: true }, PATHS).problems).toEqual(["r.json was measured on a dirty tree"]);
    const legacy = { gitSha: meta.gitSha, dirty: false };
    expect(checkProvenance(working.git, "r.json", legacy, PATHS).problems).toEqual([expect.stringContaining("has no content provenance")]);
  });

  it("fails when the recorded commit or content does not match the history", () => {
    const { working, workingShas } = workingAndPublished();
    const meta = { ...commitProvenance(working.git, workingShas[1] as string, PATHS), dirty: false };

    // The first commit exists and is an ancestor, but its measured content and author date differ.
    const wrongCommit = checkProvenance(working.git, "r.json", { ...meta, gitSha: workingShas[0] as string }, PATHS).problems;
    expect(wrongCommit).toEqual([expect.stringContaining("was not authored at"), expect.stringContaining("does not match commit")]);

    // A hand-edited content address matches neither HEAD nor the commit.
    const edited = checkProvenance(working.git, "r.json", { ...meta, measuredTree: `sha256:${"0".repeat(64)}` }, PATHS).problems;
    expect(edited).toEqual([expect.stringContaining("measured code changed"), expect.stringContaining("does not match commit")]);

    // An unknown id whose author date matches no commit with that content.
    const unknown = checkProvenance(working.git, "r.json", { ...meta, gitSha: "f".repeat(40), commitDate: "2026-09-01T00:00:00.000Z" }, PATHS).problems;
    expect(unknown).toEqual([expect.stringContaining("is not in this history")]);

    // A commit on another branch is not an ancestor of HEAD.
    working.git(["checkout", "-q", "-b", "side", workingShas[0] as string]);
    const side = working.commit({ "README.md": "side\n" }, "docs: side", "2026-10-03T10:00:00Z");
    working.git(["checkout", "-q", "main"]);
    const notAncestor = checkProvenance(working.git, "r.json", { ...meta, gitSha: side }, PATHS).problems;
    expect(notAncestor).toContain(`r.json: measured commit ${side.slice(0, 7)} is not an ancestor of HEAD`);
  });

  it("finds measured files that cite a commit id, which the publish step would rewrite", () => {
    const { working, workingShas } = workingAndPublished();
    expect(commitCitations(working.git, working.dir, PATHS)).toEqual([]);
    const cited = (workingShas[0] as string).slice(0, 9);
    working.commit({ "src/b.ts": `// measured at ${cited}\nexport const sha256 = "${"a".repeat(64)}";\n` }, "feat: b", "2026-10-04T10:00:00Z");
    expect(commitCitations(working.git, working.dir, PATHS)).toEqual([`src/b.ts cites commit ${cited}`]);
  });
});
