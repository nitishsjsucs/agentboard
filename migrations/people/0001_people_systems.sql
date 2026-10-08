-- Simulated People systems (binding PEOPLE_DB). SPEC section 6.2.
-- Every environment, production included, uses these simulated tables; there is no real HRIS.

CREATE TABLE employees (
  id                 TEXT PRIMARY KEY,          -- 'E-1001'..'E-1060'
  full_name          TEXT NOT NULL,
  work_email         TEXT NOT NULL UNIQUE,
  personal_email     TEXT NOT NULL,
  department         TEXT NOT NULL,
  title              TEXT NOT NULL,
  manager_id         TEXT,
  location           TEXT NOT NULL,
  address_json       TEXT NOT NULL,
  employment_status  TEXT NOT NULL CHECK (employment_status IN ('active','terminated','pending_start')),
  updated_at         TEXT NOT NULL
);
CREATE TABLE tickets (
  id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('laptop_provision','laptop_return','access_issue')),
  summary TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE access_grants (
  id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, system TEXT NOT NULL, role TEXT NOT NULL,
  granted_at TEXT NOT NULL, revoked_at TEXT
);
CREATE INDEX access_grants_emp ON access_grants(employee_id, revoked_at);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, channel TEXT NOT NULL, template TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','failed')), sent_at TEXT NOT NULL
);
CREATE TABLE idempotency (                      -- the integration's own ledger
  key            TEXT PRIMARY KEY,              -- per (run, step, generation, tool, args)
  tool           TEXT NOT NULL,
  args_hash      TEXT NOT NULL,
  correlation_id TEXT NOT NULL,                 -- '<runId>:<stepId>' from the token claims
  state          TEXT NOT NULL CHECK (state IN ('in_progress','completed')),
  owner          TEXT NOT NULL,                 -- '<agent instance>:<leaseId>'
  locked_until   INTEGER NOT NULL,              -- epoch ms; an in_progress row past this can be taken over
  result_json    TEXT,
  created_at     TEXT NOT NULL,
  completed_at   TEXT
);
CREATE TABLE side_effects (                     -- one row per real mutation; deliberately no UNIQUE constraints
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL,
  correlation_id  TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  generation      INTEGER NOT NULL,
  tool            TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  applied_at      TEXT NOT NULL
);
CREATE INDEX side_effects_corr ON side_effects(correlation_id);
