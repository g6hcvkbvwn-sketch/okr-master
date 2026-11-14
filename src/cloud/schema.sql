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

CREATE TABLE IF NOT EXISTS project_activity (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_changed INTEGER NOT NULL,
  change_revision INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_settings (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 0,
  due_enabled INTEGER NOT NULL DEFAULT 0,
  inactivity_enabled INTEGER NOT NULL DEFAULT 0,
  last_attempt INTEGER,
  last_success INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  event_key TEXT NOT NULL,
  recipient TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'failed')),
  lock_token TEXT NOT NULL,
  lock_until INTEGER NOT NULL,
  last_attempt INTEGER NOT NULL,
  PRIMARY KEY (project_id, rule, event_key, recipient)
);

INSERT OR IGNORE INTO project_activity (project_id, last_changed, change_revision)
SELECT id, CAST(strftime('%s', 'now') AS INTEGER), revision FROM projects;

INSERT OR IGNORE INTO notification_settings (project_id)
SELECT id FROM projects;

CREATE TRIGGER IF NOT EXISTS projects_insert_notification_tracking
AFTER INSERT ON projects
BEGIN
  INSERT INTO project_activity (project_id, last_changed, change_revision)
  VALUES (NEW.id, CAST(strftime('%s', 'now') AS INTEGER), NEW.revision);
  INSERT INTO notification_settings (project_id) VALUES (NEW.id);
END;

CREATE TRIGGER IF NOT EXISTS projects_update_activity
AFTER UPDATE ON projects
WHEN OLD.data <> NEW.data
BEGIN
  UPDATE project_activity
  SET last_changed = CAST(strftime('%s', 'now') AS INTEGER), change_revision = NEW.revision
  WHERE project_id = NEW.id;
END;
