-- History search: FTS5 external-content index over PII-free documents. SPEC section 6.1.

CREATE TABLE search_docs (
  rowid        INTEGER PRIMARY KEY,
  doc_id       TEXT NOT NULL UNIQUE,            -- 'run:<id>', 'task:<id>', 'call:<id>', 'approval:<id>'
  run_id       TEXT NOT NULL,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('run','task','tool_call','approval')),
  status       TEXT,
  request_type TEXT,
  body         TEXT NOT NULL,                   -- built without PII fields (no addresses, no personal emails, no request_text)
  created_at   TEXT NOT NULL
);
CREATE VIRTUAL TABLE search_fts USING fts5(body, content='search_docs', content_rowid='rowid', tokenize='porter unicode61');
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO search_fts(rowid, body) VALUES (new.rowid, new.body);
END;
