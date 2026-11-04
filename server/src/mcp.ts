import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TASK_STATUSES, TaskError, type TaskStore } from "./tasks.js";

/**
 * Builds the MCP server that AI coding agents talk to.
 *
 * Each agent process runs its own copy of this server (stdio transport) with
 * AGENT_NAME set, so every action is attributed to the right agent. All copies
 * share the same Postgres database, which is what lets agents coordinate.
 */
export function createMcpServer(store: TaskStore, agent: string): McpServer {
  const server = new McpServer({ name: "agent-taskboard", version: "1.0.0" });

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "List tasks on the shared board. Call this before starting work to see what is free (todo) and what other agents are doing (in_progress).",
      inputSchema: {
        status: z.enum(TASK_STATUSES).optional().describe("Only return tasks with this status"),
        mine: z.boolean().optional().describe("Only return tasks assigned to you"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ status, mine }) =>
      run(async () => {
        const tasks = await store.listTasks({ status, assignee: mine ? agent : undefined });
        if (tasks.length === 0) return "No tasks match.";
        return tasks
          .map((t) => `#${t.id} [${t.status}]${t.assignee ? ` @${t.assignee}` : ""} ${t.title}`)
          .join("\n");
      }),
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task details",
      description: "Show a task with its full history: who created, claimed and completed it, and every note.",
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run(async () => {
        const task = await store.getTask(id);
        const history = task.events
          .map((e) => `- ${e.createdAt.toString()} ${e.agent} ${e.kind}${e.message ? `: ${e.message}` : ""}`)
          .join("\n");
        return [
          `#${task.id} ${task.title}`,
          `Status: ${task.status}${task.assignee ? ` (assigned to ${task.assignee})` : ""}`,
          task.description && `\n${task.description}`,
          `\nHistory:\n${history}`,
        ]
          .filter(Boolean)
          .join("\n");
      }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create a task",
      description: "Add a new task to the shared board, e.g. to split up work or hand something off.",
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
      },
    },
    ({ title, description }) =>
      run(async () => {
        const task = await store.createTask({ title, description, agent });
        return `Created task #${task.id}: ${task.title}`;
      }),
  );

  server.registerTool(
    "claim_task",
    {
      title: "Claim a task",
      description:
        "Take ownership of a todo task before working on it. Fails if another agent already claimed it, so two agents never do the same work.",
      inputSchema: { id: z.number().int().positive() },
    },
    ({ id }) =>
      run(async () => {
        const task = await store.claimTask(id, agent);
        return `You now own task #${task.id}: ${task.title}`;
      }),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete a task",
      description: "Mark one of your tasks as done, with a short summary of what changed.",
      inputSchema: {
        id: z.number().int().positive(),
        summary: z.string().max(2000).optional(),
      },
    },
    ({ id, summary }) =>
      run(async () => {
        const task = await store.completeTask(id, agent, summary);
        return `Task #${task.id} marked as done.`;
      }),
  );

  server.registerTool(
    "release_task",
    {
      title: "Release a task",
      description: "Give one of your tasks back so another agent can pick it up. Explain why in `reason`.",
      inputSchema: {
        id: z.number().int().positive(),
        reason: z.string().max(2000).optional(),
      },
    },
    ({ id, reason }) =>
      run(async () => {
        const task = await store.releaseTask(id, agent, reason);
        return `Task #${task.id} is back in todo.`;
      }),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note",
      description: "Leave a note on a task: a decision, a blocker, or context for whoever works on it next.",
      inputSchema: {
        id: z.number().int().positive(),
        message: z.string().min(1).max(2000),
      },
    },
    ({ id, message }) =>
      run(async () => {
        await store.addNote(id, agent, message);
        return `Note added to task #${id}.`;
      }),
  );

  return server;
}

/** Turns a handler's result or domain error into an MCP tool result. */
async function run(fn: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    if (err instanceof TaskError) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
    throw err;
  }
}
