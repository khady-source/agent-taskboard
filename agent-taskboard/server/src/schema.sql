-- Agent Taskboard schema. Safe to run on every start (idempotent).

CREATE TABLE IF NOT EXISTS agents (
  name        TEXT PRIMARY KEY,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK (status IN ('todo', 'in_progress', 'done')),
  assignee     TEXT REFERENCES agents(name),
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An in-progress task must have an owner; a todo task must not.
  CHECK (
    (status = 'todo' AND assignee IS NULL) OR
    (status = 'in_progress' AND assignee IS NOT NULL) OR
    (status = 'done')
  )
);

CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);

CREATE TABLE IF NOT EXISTS task_events (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,
  kind        TEXT NOT NULL
              CHECK (kind IN ('created', 'claimed', 'released', 'completed', 'note')),
  message     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events (task_id, created_at);
