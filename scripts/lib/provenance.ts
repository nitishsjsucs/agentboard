// Provenance of a measurement that survives the publish step (ADR 0005).
//
// The GitHub repository is filled by a publish step that copies every working
// commit as a new commit (same tree, same author and author date, message
// without the Co-Authored-By trailer), so every published commit id differs
// from the working one. It rewrites working commit ids cited in files to the
// published ones, but anything that depends on a commit id existing (as the
// v0.4.0 tag's results:check did) breaks whenever a citation is not rewritten.
//
// So a result records, besides the commit id, what identifies the measurement
// without it: the measured commit's author date and a content address of the
// measured paths (sha256 over the git object ids of those paths, which are
// hashes of their content). results:check then needs no particular commit id:
// the measured content must equal HEAD's, and the measured commit must be in
// the history being checked (by id, or else by author date and content).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Runs git and returns trimmed stdout; throws on a non-zero exit. */
export type Git = (args: string[]) => string;

export function gitIn(cwd: string): Git {
  return (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

export interface CommitProvenance {
  gitSha: string;
  /** Author date of the measured commit, UTC ISO. The publish step keeps it. */
  commitDate: string;
  /** Subject of the measured commit, for people reading the file. Not compared. */
  commitSubject: string;
  /** `sha256:<hex>` over `git ls-tree <commit> -- <measured paths>`. */
  measuredTree: string;
}

/** Content address of the measured paths in `rev`: independent of commit ids, history and messages. */
export function measuredTree(git: Git, rev: string, paths: readonly string[]): string {
  const listing = git(["ls-tree", rev, "--", ...paths]);
  return `sha256:${createHash("sha256").update(listing).digest("hex")}`;
}

export function commitProvenance(git: Git, rev: string, paths: readonly string[]): CommitProvenance {
  const [sha = "", authorTime = "0", subject = ""] = git(["log", "-1", "--format=%H%x00%at%x00%s", rev]).split("\0");
  return {
    gitSha: sha,
    commitDate: new Date(Number(authorTime) * 1000).toISOString(),
    commitSubject: subject,
    measuredTree: measuredTree(git, sha, paths),
  };
}

function succeeds(git: Git, args: string[]): boolean {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function authorDate(git: Git, rev: string): string {
  return new Date(Number(git(["log", "-1", "--format=%at", rev])) * 1000).toISOString();
}

/** The oldest commit reachable from HEAD with this author date and measured content, if any. */
function findCopy(git: Git, date: string, tree: string, paths: readonly string[]): string | null {
  const seconds = String(Math.floor(Date.parse(date) / 1000));
  const candidates = git(["log", "--reverse", "--format=%H %at", "HEAD"])
    .split("\n")
    .map((line) => line.split(" "))
    .filter(([, at]) => at === seconds)
    .map(([sha]) => sha as string);
  return candidates.find((sha) => measuredTree(git, sha, paths) === tree) ?? null;
}

export interface ProvenanceCheck {
  problems: string[];
  notes: string[];
}

/**
 * Checks one result's provenance against HEAD: not measured on a dirty tree; HEAD's measured paths
 * have the recorded content; and the measured commit is in this history (by its id, which must then
 * be an ancestor of HEAD with the recorded author date and content, or, when that id is absent, as a
 * commit with the recorded author date and content, which is how a copied commit is found).
 */
export function checkProvenance(git: Git, name: string, meta: Partial<CommitProvenance> & { dirty?: boolean }, paths: readonly string[]): ProvenanceCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const short = (meta.gitSha ?? "unknown").slice(0, 7);
  if (meta.dirty !== false) problems.push(`${name} was measured on a dirty tree`);
  if (!meta.gitSha || !meta.commitDate || !meta.measuredTree) {
    problems.push(`${name} has no content provenance (commitDate, measuredTree); re-run the measurement`);
    return { problems, notes };
  }
  if (measuredTree(git, "HEAD", paths) !== meta.measuredTree) {
    problems.push(`${name}: measured code changed since ${short} (re-run the measurement)`);
  }
  let located: string | null = null;
  if (succeeds(git, ["cat-file", "-e", `${meta.gitSha}^{commit}`])) {
    if (succeeds(git, ["merge-base", "--is-ancestor", meta.gitSha, "HEAD"])) located = meta.gitSha;
    else problems.push(`${name}: measured commit ${short} is not an ancestor of HEAD`);
  } else {
    located = findCopy(git, meta.commitDate, meta.measuredTree, paths);
    if (located) notes.push(`${name}: measured commit ${short} is not in this history; its copy here is ${located.slice(0, 7)} (same author date and measured content)`);
    else problems.push(`${name}: measured commit ${short} (authored ${meta.commitDate}) is not in this history, by id or by author date and measured content`);
  }
  if (located) {
    if (authorDate(git, located) !== meta.commitDate) problems.push(`${name}: commit ${short} was not authored at the recorded ${meta.commitDate}`);
    if (measuredTree(git, located, paths) !== meta.measuredTree) problems.push(`${name}: the recorded measured content does not match commit ${short}`);
  }
  return { problems, notes };
}

/** The same token rule as the publish step's commit-id rewrite (full ids, and 7 to 12 hex characters standing alone). */
const COMMIT_TOKEN = /(?<![0-9a-zA-Z])[0-9a-f]{7,40}(?![0-9a-zA-Z])/g;

/**
 * Files under the measured paths that cite a commit of this history. The publish step rewrites such
 * citations in every file, so the published measured content would differ from what was measured,
 * and results:check would pass here and fail on GitHub.
 */
export function commitCitations(git: Git, root: string, paths: readonly string[]): string[] {
  const commits = git(["rev-list", "HEAD"]).split("\n").filter(Boolean);
  const full = new Set(commits);
  const prefixes = new Set(commits.map((sha) => sha.slice(0, 7)));
  const found: string[] = [];
  for (const file of git(["ls-files", "--", ...paths]).split("\n").filter(Boolean)) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(COMMIT_TOKEN)) {
      const token = match[0];
      const cites = token.length === 40 ? full.has(token) : token.length <= 12 && prefixes.has(token.slice(0, 7)) && commits.some((sha) => sha.startsWith(token));
      if (cites) found.push(`${file} cites commit ${token}`);
    }
  }
  return found;
}
