import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/api.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { createMcpServer } from "../src/mcp.js";
import { TaskStore } from "../src/tasks.js";

// Runs against a real Postgres. Set TEST_DATABASE_URL in .env (see README).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on the environment (e.g. CI).
}
const url = process.env.TEST_DATABASE_URL ?? "postgres://taskboard:taskboard@localhost:5432/taskboard_test";

let db: Db;
let store: TaskStore;

beforeAll(async () => {
  db = createPool(url);
  await migrate(db);
  store = new TaskStore(db);
});

beforeEach(async () => {
  await db.query("TRUNCATE task_events, tasks, agents RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await db.end();
});

describe("TaskStore", () => {
  it("runs a task through its full lifecycle", async () => {
    const task = await store.createTask({ title: "Write README", agent: "claude" });
    expect(task.status).toBe("todo");

    const claimed = await store.claimTask(task.id, "codex");
    expect(claimed).toMatchObject({ status: "in_progress", assignee: "codex" });

    await store.addNote(task.id, "claude", "Mention the MCP setup");
    const done = await store.completeTask(task.id, "codex", "README added");
    expect(done.status).toBe("done");

    const { events } = await store.getTask(task.id);
    expect(events.map((e) => e.kind)).toEqual(["created", "claimed", "note", "completed"]);
  });

  it("lets exactly one agent win when many claim the same task at once", async () => {
    const task = await store.createTask({ title: "Fix login bug", agent: "lead" });
    const agents = Array.from({ length: 20 }, (_, i) => `agent-${i}`);

    const results = await Promise.allSettled(agents.map((a) => store.claimTask(task.id, a)));

    const winners = results.filter((r) => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.every((r) => (r as PromiseRejectedResult).reason.code === "CONFLICT")).toBe(true);
  });

  it("only lets the owner complete or release a task", async () => {
    const task = await store.createTask({ title: "Refactor", agent: "lead" });
    await store.claimTask(task.id, "alice");

    await expect(store.completeTask(task.id, "bob")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.releaseTask(task.id, "bob")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const released = await store.releaseTask(task.id, "alice", "Blocked on API keys");
    expect(released).toMatchObject({ status: "todo", assignee: null });
  });

  it("reports missing tasks clearly", async () => {
    await expect(store.claimTask(999, "alice")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tracks agents and their active tasks", async () => {
    const a = await store.createTask({ title: "A", agent: "lead" });
    await store.createTask({ title: "B", agent: "lead" });
    await store.claimTask(a.id, "alice");

    const agents = await store.listAgents();
    expect(agents.find((x) => x.name === "alice")?.activeTasks).toBe(1);
    expect(agents.find((x) => x.name === "lead")?.activeTasks).toBe(0);
  });
});

describe("REST API", () => {
  it("creates, claims and lists tasks", async () => {
    const app = createApp(store);

    const created = await request(app).post("/api/tasks").send({ title: "Ship v1", agent: "web" }).expect(201);
    await request(app).post(`/api/tasks/${created.body.id}/claim`).send({ agent: "claude" }).expect(200);

    const list = await request(app).get("/api/tasks?status=in_progress").expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].assignee).toBe("claude");
  });

  it("maps domain errors to HTTP status codes", async () => {
    const app = createApp(store);
    const { body } = await request(app).post("/api/tasks").send({ title: "X", agent: "web" });
    await request(app).post(`/api/tasks/${body.id}/claim`).send({ agent: "a" });

    await request(app).post(`/api/tasks/${body.id}/claim`).send({ agent: "b" }).expect(409);
    await request(app).post(`/api/tasks/${body.id}/complete`).send({ agent: "b" }).expect(403);
    await request(app).get("/api/tasks/12345").expect(404);
    await request(app).post("/api/tasks").send({ agent: "web" }).expect(400);
  });
});

describe("MCP server", () => {
  async function connect(agent: string) {
    const server = createMcpServer(store, agent);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    (result.content as { type: string; text: string }[])[0]!.text;

  it("exposes the coordination tools", async () => {
    const client = await connect("claude");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["add_note", "claim_task", "complete_task", "create_task", "get_task", "list_tasks", "release_task"].sort(),
    );
  });

  it("lets two agents coordinate on the same board", async () => {
    const claude = await connect("claude");
    const codex = await connect("codex");

    await claude.callTool({ name: "create_task", arguments: { title: "Add dark mode" } });
    expect(text(await codex.callTool({ name: "claim_task", arguments: { id: 1 } }))).toContain("You now own task #1");

    const second = await claude.callTool({ name: "claim_task", arguments: { id: 1 } });
    expect(second.isError).toBe(true);
    expect(text(second)).toContain("already claimed by codex");

    const board = text(await claude.callTool({ name: "list_tasks", arguments: {} }));
    expect(board).toContain("#1 [in_progress] @codex Add dark mode");
  });
});
