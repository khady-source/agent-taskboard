import { fileURLToPath } from "node:url";
import { createApp } from "./api.js";
import { createPool, migrate } from "./db.js";
import { TaskStore } from "./tasks.js";

const port = Number(process.env.PORT ?? 3000);
const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL("../../web/dist", import.meta.url));

const db = createPool();
await migrate(db);

const app = createApp(new TaskStore(db), { staticDir });
const server = app.listen(port, () => {
  console.log(`Agent Taskboard API listening on http://localhost:${port}`);
});

const shutdown = () => {
  server.close(() => void db.end().then(() => process.exit(0)));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
