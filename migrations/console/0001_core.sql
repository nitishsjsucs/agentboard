-- AgentBoard console database (binding DB). SPEC section 6.1.

CREATE TABLE role_bindings (
  principal     TEXT PRIMARY KEY CHECK (principal = lower(principal)),  -- email, or 'svc:<common_name>'
  role          TEXT NOT NULL CHECK (role IN ('viewer','operator','approver','admin')),
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL
);

CREATE TABLE runs (
  id                  TEXT PRIMARY KEY,         -- run_<ULID>, minted by the API at reservation
  requester           TEXT NOT NULL,            -- principal id (lowercase)
  client_request_id   TEXT NOT NULL,            -- launch idempotency key, scoped to the requester
  request_hash        TEXT NOT NULL,            -- sha256 of the canonical launch body
  request_type        TEXT NOT NULL CHECK (request_type IN ('address_change','manager_change','onboarding_access','privileged_access','offboarding','access_revocation')),
  title               TEXT NOT NULL,
  request_text        TEXT NOT NULL,
  subject_employee_id TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status              TEXT NOT NULL CHECK (status IN ('queued','planning','running','awaiting_approval','paused','needs_attention','succeeded','rejected','cancelled')),
  status_reason       TEXT,
  budget_json         TEXT NOT NULL,
  usage_json          TEXT NOT NULL,
  synthetic_ref       TEXT,                     -- 'syn-0001'..'syn-0100' when launched by the simulator
  requested_at        TEXT NOT NULL,            -- business timestamp (synthetic: spread over 28 days)
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  finished_at         TEXT,
  version             INTEGER NOT NULL,         -- 0 at reservation; then the coordinator's run version
  UNIQUE (requester, client_request_id)
);
CREATE INDEX runs_status_updated  ON runs(status, updated_at DESC);
CREATE INDEX runs_type_created    ON runs(request_type, created_at DESC);
CREATE INDEX runs_requester       ON runs(requester, created_at DESC);

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,           -- tsk_<ULID>
  run_id            TEXT NOT NULL REFERENCES runs(id),
  kind              TEXT NOT NULL CHECK (kind IN ('plan','execute','verify')),
  step_id           TEXT,                       -- 's1'..'s8' for execute/verify
  tool              TEXT,
  args_json         TEXT,
  depends_on_json   TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL CHECK (status IN ('pending','ready','leased','awaiting_approval','held','succeeded','failed','rejected','skipped','cancelled','dead_lettered','budget_blocked')),
  hold_reason       TEXT CHECK (hold_reason IN ('role_disabled','checkpoint')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  generation        INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  lease_owner       TEXT,
  lease_epoch       INTEGER NOT NULL DEFAULT 0,
  lease_expires_at  TEXT,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  version           INTEGER NOT NULL            -- mirrored writes apply only when version increases
);
CREATE INDEX tasks_run    ON tasks(run_id);
CREATE INDEX tasks_status ON tasks(status, updated_at);
CREATE INDEX tasks_held   ON tasks(status, hold_reason, kind);

CREATE TABLE tool_calls (                       -- one row per MCP call, written when the call finishes
  id               TEXT PRIMARY KEY,            -- call_<ULID>, minted by the calling agent; inserts use ON CONFLICT(id) DO NOTHING
  run_id           TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  step_id          TEXT,
  agent            TEXT NOT NULL,               -- 'executor-1', 'verifier-0', 'planner-1'
  tool             TEXT NOT NULL,               -- 'tools/list' for the planner's catalog read
  args_json        TEXT NOT NULL,               -- stored in full, redacted at read time
  idempotency_key  TEXT,                        -- null for reads
  attempt          INTEGER NOT NULL,
  generation       INTEGER NOT NULL,
  lease_epoch      INTEGER NOT NULL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('ok','replayed','retryable_error','permanent_error','forbidden','in_progress','timeout')),
  result_json      TEXT,
  error            TEXT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT NOT NULL,
  duration_ms      INTEGER NOT NULL
);
CREATE INDEX tool_calls_run ON tool_calls(run_id, started_at);
CREATE INDEX tool_calls_key ON tool_calls(idempotency_key);

CREATE TABLE approvals (                        -- mirror; the coordinator is the only writer
  id             TEXT PRIMARY KEY,              -- apr_<ULID>
  run_id         TEXT NOT NULL,
  task_id        TEXT NOT NULL,
  generation     INTEGER NOT NULL,
  tool           TEXT NOT NULL,
  summary        TEXT NOT NULL,                 -- human readable, redacted
  risk           TEXT NOT NULL CHECK (risk IN ('medium','high')),
  requester      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
  requested_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  decided_by     TEXT,
  decided_at     TEXT,
  decision_note  TEXT,
  version        INTEGER NOT NULL,
  UNIQUE (task_id, generation)
);
CREATE INDEX approvals_status ON approvals(status, requested_at);

CREATE TABLE dlq_messages (
  id           TEXT PRIMARY KEY,                -- queue message id
  run_id       TEXT,
  task_id      TEXT,
  dispatch_id  TEXT,
  body_json    TEXT NOT NULL,
  attempts     INTEGER NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('dead_lettered','ignored_stale','poison')),
  received_at  TEXT NOT NULL,
  replayed_at  TEXT,
  replayed_by  TEXT
);

CREATE TABLE agent_controls (
  role        TEXT PRIMARY KEY CHECK (role IN ('planner','executor','verifier')),
  disabled    INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
