-- Append-only, hash-chained audit events. SPEC section 6.1.

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stream      TEXT NOT NULL,                    -- 'run:<runId>' or 'global'
  seq         INTEGER NOT NULL,                 -- contiguous per stream, starting at 1
  ts          TEXT NOT NULL,                    -- ISO-8601 UTC with milliseconds
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('user','service','agent','system')),
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  run_id      TEXT,
  task_id     TEXT,
  detail_json TEXT NOT NULL,                    -- redacted at write time (no addresses, no personal emails, args as argsSha256)
  prev_hash   TEXT NOT NULL,                    -- 64 zeros for seq 1
  hash        TEXT NOT NULL,
  UNIQUE (stream, seq)
);
CREATE INDEX audit_run    ON audit_events(run_id, seq);
CREATE INDEX audit_actor  ON audit_events(actor_id, ts);
CREATE INDEX audit_action ON audit_events(action, ts);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
