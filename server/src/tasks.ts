import type { PoolClient } from "pg";
import type { Db } from "./db.js";

export type TaskStatus = "todo" | "in_progress" | "done";
export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

export interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: number;
  taskId: number;
  agent: string;
  kind: "created" | "claimed" | "released" | "completed" | "note";
  message: string;
  createdAt: string;
}

export interface Agent {
  name: string;
  lastSeen: string;
  activeTasks: number;
}

export type TaskErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "INVALID";

/** Domain error with a stable code, mapped to HTTP statuses / MCP errors by callers. */
export class TaskError extends Error {
  constructor(
    public readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

const TASK_COLUMNS = `id, title, description, status, assignee,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

/**
 * All task operations live here so the REST API and the MCP server
 * share exactly the same rules.
 */
export class TaskStore {
  constructor(private readonly db: Db) {}

  async listTasks(filter: { status?: TaskStatus; assignee?: string } = {}): Promise<Task[]> {
    const { rows } = await this.db.query<Task>(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE ($1::text IS NULL OR status = $1)
         AND ($2::text IS NULL OR assignee = $2)
       ORDER BY id`,
      [filter.status ?? null, filter.assignee ?? null],
    );
    return rows;
  }

  async getTask(id: number): Promise<Task & { events: TaskEvent[] }> {
    const task = await this.findTask(this.db, id);
    const { rows: events } = await this.db.query<TaskEvent>(
      `SELECT id, task_id AS "taskId", agent, kind, message, created_at AS "createdAt"
       FROM task_events WHERE task_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return { ...task, events };
  }

  async createTask(input: { title: string; description?: string; agent: string }): Promise<Task> {
    const title = input.title.trim();
    if (!title) throw new TaskError("INVALID", "Title cannot be empty");
    return this.transaction(async (client) => {
      await this.touchAgent(client, input.agent);
      const { rows } = await client.query<Task>(
        `INSERT INTO tasks (title, description, created_by)
         VALUES ($1, $2, $3) RETURNING ${TASK_COLUMNS}`,
        [title, input.description ?? "", input.agent],
      );
      const task = rows[0]!;
      await this.logEvent(client, task.id, input.agent, "created");
      return task;
    });
  }

  /**
   * Atomically gives a `todo` task to an agent. If two agents race for the
   * same task, Postgres row locking guarantees exactly one of them wins.
   */
  async claimTask(id: number, agent: string): Promise<Task> {
    return this.transaction(async (client) => {
      await this.touchAgent(client, agent);
      const { rows } = await client.query<Task>(
        `UPDATE tasks SET status = 'in_progress', assignee = $2, updated_at = now()
         WHERE id = $1 AND status = 'todo'
         RETURNING ${TASK_COLUMNS}`,
        [id, agent],
      );
      if (!rows[0]) {
        const current = await this.findTask(client, id);
        throw new TaskError(
          "CONFLICT",
          current.status === "done"
            ? `Task #${id} is already done`
            : `Task #${id} is already claimed by ${current.assignee}`,
        );
      }
      await this.logEvent(client, id, agent, "claimed");
      return rows[0];
    });
  }

  /** Gives a task back to the pool. Only its current owner can do this. */
  async releaseTask(id: number, agent: string, reason = ""): Promise<Task> {
    return this.transitionOwnedTask(id, agent, "todo", "released", reason);
  }

  /** Marks a task as done. Only its current owner can do this. */
  async completeTask(id: number, agent: string, summary = ""): Promise<Task> {
    return this.transitionOwnedTask(id, agent, "done", "completed", summary);
  }

  /** Any agent can leave a note on any task (decisions, blockers, hand-off context). */
  async addNote(id: number, agent: string, message: string): Promise<TaskEvent> {
    if (!message.trim()) throw new TaskError("INVALID", "Note cannot be empty");
    return this.transaction(async (client) => {
      await this.findTask(client, id);
      await this.touchAgent(client, agent);
      return this.logEvent(client, id, agent, "note", message.trim());
    });
  }

  async listAgents(): Promise<Agent[]> {
    const { rows } = await this.db.query<Agent>(
      `SELECT a.name, a.last_seen AS "lastSeen",
              count(t.id) FILTER (WHERE t.status = 'in_progress')::int AS "activeTasks"
       FROM agents a LEFT JOIN tasks t ON t.assignee = a.name
       GROUP BY a.name ORDER BY a.last_seen DESC`,
    );
    return rows;
  }

  // --- internals -----------------------------------------------------------

  private async transitionOwnedTask(
    id: number,
    agent: string,
    to: "todo" | "done",
    kind: "released" | "completed",
    message: string,
  ): Promise<Task> {
    return this.transaction(async (client) => {
      await this.touchAgent(client, agent);
      const { rows } = await client.query<Task>(
        `UPDATE tasks
         SET status = $3,
             assignee = CASE WHEN $3 = 'todo' THEN NULL ELSE assignee END,
             updated_at = now()
         WHERE id = $1 AND status = 'in_progress' AND assignee = $2
         RETURNING ${TASK_COLUMNS}`,
        [id, agent, to],
      );
      if (!rows[0]) {
        const current = await this.findTask(client, id);
        if (current.status !== "in_progress") {
          throw new TaskError("CONFLICT", `Task #${id} is not in progress (status: ${current.status})`);
        }
        throw new TaskError("FORBIDDEN", `Task #${id} belongs to ${current.assignee}, not ${agent}`);
      }
      await this.logEvent(client, id, agent, kind, message);
      return rows[0];
    });
  }

  private async findTask(client: Db | PoolClient, id: number): Promise<Task> {
    const { rows } = await client.query<Task>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1`, [id]);
    if (!rows[0]) throw new TaskError("NOT_FOUND", `Task #${id} does not exist`);
    return rows[0];
  }

  private async touchAgent(client: PoolClient, name: string): Promise<void> {
    if (!name.trim()) throw new TaskError("INVALID", "Agent name cannot be empty");
    await client.query(
      `INSERT INTO agents (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET last_seen = now()`,
      [name],
    );
  }

  private async logEvent(
    client: PoolClient,
    taskId: number,
    agent: string,
    kind: TaskEvent["kind"],
    message = "",
  ): Promise<TaskEvent> {
    const { rows } = await client.query<TaskEvent>(
      `INSERT INTO task_events (task_id, agent, kind, message) VALUES ($1, $2, $3, $4)
       RETURNING id, task_id AS "taskId", agent, kind, message, created_at AS "createdAt"`,
      [taskId, agent, kind, message],
    );
    return rows[0]!;
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
