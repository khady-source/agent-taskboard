import { existsSync } from "node:fs";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import { TASK_STATUSES, TaskError, type TaskStore } from "./tasks.js";

const agentName = z.string().trim().min(1).max(64);
const idParam = z.coerce.number().int().positive();

const schemas = {
  listQuery: z.object({
    status: z.enum(TASK_STATUSES).optional(),
    assignee: z.string().optional(),
  }),
  create: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    agent: agentName,
  }),
  agentOnly: z.object({ agent: agentName }),
  release: z.object({ agent: agentName, reason: z.string().max(2000).optional() }),
  complete: z.object({ agent: agentName, summary: z.string().max(2000).optional() }),
  note: z.object({ agent: agentName, message: z.string().trim().min(1).max(2000) }),
};

const HTTP_STATUS: Record<TaskError["code"], number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  INVALID: 400,
};

export function createApp(store: TaskStore, options: { staticDir?: string } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/tasks", async (req, res) => {
    res.json(await store.listTasks(schemas.listQuery.parse(req.query)));
  });

  app.get("/api/tasks/:id", async (req, res) => {
    res.json(await store.getTask(idParam.parse(req.params.id)));
  });

  app.post("/api/tasks", async (req, res) => {
    res.status(201).json(await store.createTask(schemas.create.parse(req.body)));
  });

  app.post("/api/tasks/:id/claim", async (req, res) => {
    const { agent } = schemas.agentOnly.parse(req.body);
    res.json(await store.claimTask(idParam.parse(req.params.id), agent));
  });

  app.post("/api/tasks/:id/release", async (req, res) => {
    const { agent, reason } = schemas.release.parse(req.body);
    res.json(await store.releaseTask(idParam.parse(req.params.id), agent, reason));
  });

  app.post("/api/tasks/:id/complete", async (req, res) => {
    const { agent, summary } = schemas.complete.parse(req.body);
    res.json(await store.completeTask(idParam.parse(req.params.id), agent, summary));
  });

  app.post("/api/tasks/:id/notes", async (req, res) => {
    const { agent, message } = schemas.note.parse(req.body);
    res.status(201).json(await store.addNote(idParam.parse(req.params.id), agent, message));
  });

  app.get("/api/agents", async (_req, res) => {
    res.json(await store.listAgents());
  });

  // In production the dashboard is served by the same process.
  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile("index.html", { root: options.staticDir });
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof TaskError) {
      res.status(HTTP_STATUS[err.code]).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "INVALID", message: z.prettifyError(err) });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "INTERNAL", message: "Unexpected server error" });
  };
  app.use(errorHandler);

  return app;
}
