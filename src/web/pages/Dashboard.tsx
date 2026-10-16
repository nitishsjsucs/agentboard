import { Link } from "react-router";
import type { AgentRolesResponse, DlqMessageView, MetricsSummary, OpenRunStatus, Page, RunSummary } from "../../shared/api-types.ts";
import { api } from "../api/client.ts";
import { useCan, usePolling } from "../api/hooks.ts";
import { ageMs, formatDuration, formatDurationWords, useNow } from "../api/time.ts";
import { AgentRolePanel } from "../components/AgentRolePanel.tsx";
import { DlqPanel } from "../components/DlqPanel.tsx";
import { ErrorNotice } from "../components/ErrorNotice.tsx";
import { whoActsForReason } from "../components/explain.ts";
import { LoadingLine, PolledView, StaleNotice } from "../components/PolledView.tsx";
import { usePageTitle } from "../api/usePageTitle.ts";
import { RunTable } from "../components/RunTable.tsx";

/** A count, or a dash while the summary has never loaded (never a 0 that is not real). */
function StatValue({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <div className="stat__value">
        <span aria-hidden="true">-</span>
        <span className="visually-hidden">not loaded</span>
      </div>
    );
  }
  return <div className="stat__value">{value}</div>;
}

interface Tile {
  key: string;
  label: string;
  value: number | null;
  /** Sub-lines under the label, in plain words (ages and who acts are text, never colour). */
  lines: string[];
  /** The link's accessible name: the visible label first (so "click Needs attention" finds it), then the count and the sub-lines. */
  name: string;
  /** A route (react-router) or an in-page anchor; neither makes a plain tile. */
  to?: string;
  href?: string;
}

function StatTile({ tile }: { tile: Tile }) {
  const body = (
    <>
      <StatValue value={tile.value} />
      <div className="stat__label">{tile.label}</div>
      {tile.lines.map((line) => (
        <div key={line} className="stat__line">
          {line}
        </div>
      ))}
    </>
  );
  if (tile.to) {
    return (
      <Link to={tile.to} className="card stat stat--link" data-testid="stat" data-tile={tile.key} aria-label={tile.name}>
        {body}
      </Link>
    );
  }
  if (tile.href) {
    return (
      <a href={tile.href} className="card stat stat--link" data-testid="stat" data-tile={tile.key} aria-label={tile.name}>
        {body}
      </a>
    );
  }
  return (
    <div className="card stat" data-testid="stat" data-tile={tile.key}>
      {body}
    </div>
  );
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const andList = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "3 need an operator, 1 an admin" (visible) and "3 need an operator and 1 an admin" (spoken); the two always sum to the count. */
export function actorSplit(byReason: MetricsSummary["needsAttentionByReason"]): { text: string; spoken: string } | null {
  let operator = 0;
  let admin = 0;
  for (const row of byReason) {
    if (whoActsForReason(row.reason).actor === "admin") admin += row.count;
    else operator += row.count;
  }
  const verb = (n: number) => (n === 1 ? "needs" : "need");
  if (operator > 0 && admin > 0) return { text: `${operator} ${verb(operator)} an operator, ${admin} an admin`, spoken: `${operator} ${verb(operator)} an operator and ${admin} an admin` };
  if (operator > 0) return { text: `${operator} ${verb(operator)} an operator`, spoken: `${operator} ${verb(operator)} an operator` };
  if (admin > 0) return { text: `${admin} ${verb(admin)} an admin`, spoken: `${admin} ${verb(admin)} an admin` };
  return null;
}

/** The "Needs a person" tiles and the "Moving" tile, from one summary; null values while it has not loaded. */
export function dashboardTiles(summary: MetricsSummary | null, options: { canDecide: boolean; canReadDlq: boolean; now: number }): { needs: Tile[]; moving: Tile } {
  const { canDecide, canReadDlq, now } = options;
  const open = (status: OpenRunStatus) => summary?.open.find((o) => o.status === status);
  const loaded = summary !== null;
  const notLoaded = (label: string) => `${label}, not loaded`;
  const tiles: Tile[] = [];

  const approvals = summary?.approvals;
  const expiry = approvals?.soonestExpiry ? Date.parse(approvals.soonestExpiry) - now : null;
  if (canDecide) {
    const label = "Approvals you can decide";
    const value = approvals ? (approvals.decidableByYou ?? 0) : null;
    const lines = !approvals ? [] : approvals.pending === 0 ? ["none pending"] : [`of ${approvals.pending} pending`, expiry !== null ? `next expires in ${formatDuration(expiry)}` : "every pending one is past its expiry"];
    const spoken = !approvals
      ? notLoaded(label)
      : approvals.pending === 0
        ? `${label}: 0, none pending`
        : `${label}: ${value ?? 0}, of ${approvals.pending} pending${expiry !== null ? `, next expires in ${formatDurationWords(expiry)}` : ""}`;
    tiles.push({ key: "approvals", label, value, lines, name: spoken, to: "/approvals" });
  } else {
    const label = "Pending approvals";
    const value = approvals ? approvals.pending : null;
    tiles.push({
      key: "approvals",
      label,
      value,
      lines: loaded ? ["Approvers and admins decide these"] : [],
      name: approvals ? `${label}: ${approvals.pending}, approvers and admins decide these` : notLoaded(label),
      to: "/approvals",
    });
  }

  {
    const label = "Needs attention";
    const row = open("needs_attention");
    const value = loaded ? (row?.count ?? 0) : null;
    const split = summary ? actorSplit(summary.needsAttentionByReason) : null;
    const age = row ? ageMs(row.oldestUpdatedAt, now) : 0;
    const lines = !loaded ? [] : !row || row.count === 0 ? ["none right now"] : [`oldest unchanged for ${formatDuration(age)}`, ...(split ? [split.text] : [])];
    const name = !loaded
      ? notLoaded(label)
      : !row || row.count === 0
        ? `${label}: 0 runs`
        : `${label}: ${count(row.count, "run", "runs")}, oldest unchanged for ${formatDurationWords(age)}${split ? `, ${split.spoken}` : ""}`;
    tiles.push({ key: "needs_attention", label, value, lines, name, to: "/runs?status=needs_attention" });
  }

  {
    const label = "Held by a disabled role";
    const held = summary?.heldRuns;
    const roles = held ? held.byRole.map((r) => r.role) : [];
    const disabled = roles.length === 0 ? "" : `${andList(roles)} ${roles.length === 1 ? "role" : "roles"} disabled`;
    const lines = !held ? [] : held.total === 0 ? ["No runs are held"] : [`${disabled}; an admin can enable ${roles.length === 1 ? "it" : "them"}`];
    const name = !held
      ? notLoaded(label)
      : held.total === 0
        ? `${label}: 0 runs`
        : `${label}: ${count(held.total, "run", "runs")}, ${disabled}, an admin can enable ${roles.length === 1 ? "it" : "them"}`;
    tiles.push({ key: "held", label, value: held ? held.total : null, lines, name, href: "#agent-roles" });
  }

  {
    const label = "Paused";
    const row = open("paused");
    const value = loaded ? (row?.count ?? 0) : null;
    const age = row ? ageMs(row.oldestUpdatedAt, now) : 0;
    const lines = !loaded ? [] : !row || row.count === 0 ? ["none paused"] : [`oldest paused for ${formatDuration(age)}`];
    const name = !loaded ? notLoaded(label) : !row || row.count === 0 ? `${label}: 0 runs` : `${label}: ${count(row.count, "run", "runs")}, oldest paused for ${formatDurationWords(age)}`;
    tiles.push({ key: "paused", label, value, lines, name, to: "/runs?status=paused" });
  }

  // Only roles that can open the dead-letter panel get its tile (the API sends null to the others).
  if (canReadDlq && (summary === null || summary.dlqOpen !== null)) {
    const label = "Open dead letters";
    const value = summary?.dlqOpen ?? null;
    const lines = value === null ? [] : value === 0 ? ["nothing to replay"] : ["an admin can replay them"];
    const name = value === null ? notLoaded(label) : value === 0 ? `${label}: 0` : `${label}: ${value}, an admin can replay them`;
    tiles.push({ key: "dlq", label, value, lines, name, href: "#dead-letters" });
  }

  const active = (["queued", "planning", "running"] as const).map(open).filter((o) => o !== undefined);
  const activeCount = loaded ? active.reduce((sum, o) => sum + o.count, 0) : null;
  const oldestActive = active.map((o) => o.oldestUpdatedAt).sort()[0];
  const heldTotal = summary?.heldRuns.total ?? 0;
  const moving: Tile = {
    key: "active",
    label: "Active (queued, planning, running)",
    value: activeCount,
    lines:
      activeCount === null
        ? []
        : activeCount === 0
          ? ["nothing is moving"]
          : [`longest without a change: ${formatDuration(ageMs(oldestActive, now))}`, ...(heldTotal > 0 ? [`includes ${heldTotal} held`] : [])],
    name: "",
  };
  return { needs: tiles, moving };
}

export function Dashboard() {
  usePageTitle("Dashboard");
  const canReadDlq = useCan("dlq:read");
  const canDecide = useCan("approvals:decide");
  // Ages and the next expiry move every 30 s from the client clock, without fetching.
  const now = useNow(30_000);
  const summary = usePolling(() => api.get<MetricsSummary>("/api/metrics/summary"), []);
  const recent = usePolling(() => api.get<Page<RunSummary>>("/api/runs?limit=10"), []);
  const attention = usePolling(() => api.get<Page<RunSummary>>("/api/runs?status=needs_attention&limit=5"), []);
  const agents = usePolling(() => api.get<AgentRolesResponse>("/api/agents"), []);
  const dlq = usePolling(() => api.get<Page<DlqMessageView>>("/api/dlq"), [canReadDlq], { enabled: canReadDlq });

  const { needs, moving } = dashboardTiles(summary.data, { canDecide, canReadDlq, now });
  const finished = summary.data?.byStatus ?? null;
  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <h1 tabIndex={-1}>Dashboard</h1>
          <p>Agent runs serving a simulated People-operations team.</p>
        </div>
      </div>

      {summary.data === null ? (
        summary.error ? (
          <ErrorNotice error={summary.error} title="Counts are unavailable right now." action="read the run counts" onRetry={summary.refresh} />
        ) : (
          <LoadingLine text="Loading counts..." />
        )
      ) : summary.error ? (
        <StaleNotice updatedAt={summary.updatedAt} onRetry={summary.refresh} />
      ) : null}

      <section className="dash-section" aria-labelledby="dash-needs">
        <h2 id="dash-needs">Needs a person</h2>
        <div className="grid grid--stats">
          {needs.map((tile) => (
            <StatTile key={tile.key} tile={tile} />
          ))}
        </div>
      </section>

      <section className="dash-section" aria-labelledby="dash-moving">
        <h2 id="dash-moving">Moving</h2>
        <div className="card stat stat--row" data-testid="stat" data-tile={moving.key}>
          <StatValue value={moving.value} />
          <div className="stat__label">{moving.label}</div>
          {moving.lines.map((line) => (
            <div key={line} className="stat__line">
              {line}
            </div>
          ))}
        </div>
        {finished ? (
          <p className="small muted dash-finished" data-testid="finished-line">
            {finished["succeeded"] ?? 0} succeeded, {finished["rejected"] ?? 0} rejected, {finished["cancelled"] ?? 0} cancelled (all time).
          </p>
        ) : null}
      </section>

      {/* The lists and panels below get h2s of their own, so they do not read as parts of "Moving". */}
      <section className="stack" aria-labelledby="dash-runs">
        <h2 id="dash-runs" className="visually-hidden">
          Runs
        </h2>
        {attention.data && attention.data.items.length > 0 ? (
          <div className="card">
            <div className="card__header">
              <h3>Needs attention</h3>
              <Link to="/runs?status=needs_attention" className="small">
                all
              </Link>
            </div>
            {attention.error ? (
              <div className="card__body">
                <StaleNotice updatedAt={attention.updatedAt} onRetry={attention.refresh} />
              </div>
            ) : null}
            <RunTable runs={attention.data.items} />
          </div>
        ) : attention.error && !attention.data ? (
          <PolledView polled={attention} loading="Loading runs that need attention..." action="read runs" card="Needs attention">
            {() => null}
          </PolledView>
        ) : null}

        <div className="card">
          <div className="card__header">
            <h3>Recent runs</h3>
            <Link to="/runs" className="small">
              all runs
            </Link>
          </div>
          <PolledView polled={recent} loading="Loading runs..." action="read runs" padded>
            {(page) => <RunTable runs={page.items} />}
          </PolledView>
        </div>
      </section>

      <section aria-labelledby="dash-agents">
        <h2 id="dash-agents" className="visually-hidden">
          {canReadDlq ? "Agents and dead letters" : "Agents"}
        </h2>
        <div className="grid grid--two">
          {/* Anchors for the "Held by a disabled role" and "Open dead letters" tiles. */}
          <div id="agent-roles" tabIndex={-1} className="anchor-target">
            <PolledView polled={agents} loading="Loading agent roles..." action="read agent roles" card="Agent roles">
              {(data) => <AgentRolePanel roles={data.roles} onChange={() => (agents.refresh(), summary.refresh())} />}
            </PolledView>
          </div>
          {canReadDlq ? (
            <div id="dead-letters" tabIndex={-1} className="anchor-target">
              <PolledView polled={dlq} loading="Loading dead letters..." action="read the dead-letter queue" card="Dead-letter queue">
                {(page) => <DlqPanel messages={page.items} onChange={() => (dlq.refresh(), summary.refresh())} />}
              </PolledView>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
