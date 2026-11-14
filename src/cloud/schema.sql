CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_changes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT OR IGNORE INTO project_changes (id, revision) VALUES (1, 0);

CREATE TRIGGER IF NOT EXISTS projects_insert_revision
AFTER INSERT ON projects
BEGIN
  UPDATE project_changes SET revision = revision + 1 WHERE id = 1;
END;

CREATE TABLE IF NOT EXISTS backup_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT,
  last_attempt TEXT,
  last_success TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS backup_tracking (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_revision INTEGER,
  lock_token TEXT,
  lock_until INTEGER
);

CREATE TRIGGER IF NOT EXISTS projects_update_revision
AFTER UPDATE ON projects
BEGIN
  UPDATE project_changes SET revision = revision + 1 WHERE id = 1;
END;
