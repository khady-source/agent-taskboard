import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPool, migrate } from "./db.js";
import { createMcpServer } from "./mcp.js";
import { TaskStore } from "./tasks.js";

// stdout is reserved for the MCP protocol: log to stderr only.
const agent = process.env.AGENT_NAME?.trim();
if (!agent) {
  console.error("AGENT_NAME is required so actions can be attributed to this agent.");
  process.exit(1);
}

const db = createPool();
await migrate(db);

const server = createMcpServer(new TaskStore(db), agent);
await server.connect(new StdioServerTransport());
console.error(`agent-taskboard MCP server ready (agent: ${agent})`);
