/**
 * Simulates three AI agents sharing one board through real MCP connections.
 * Run with `npm run demo` (needs DATABASE_URL), then open the dashboard.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connectAgent(name: string) {
  const client = new Client({ name: "demo", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/mcp-stdio.ts"],
      env: { ...process.env, AGENT_NAME: name } as Record<string, string>,
      stderr: "ignore",
    }),
  );
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: tool, arguments: args });
    const text = (result.content as { text: string }[])[0]?.text;
    console.log(`[${name}] ${tool} → ${text}`);
  };
}

const claude = await connectAgent("claude-code");
const codex = await connectAgent("codex");
const cursor = await connectAgent("cursor");

await claude("create_task", {
  title: "Add dark mode to the settings page",
  description: "Respect prefers-color-scheme and add a manual toggle.",
});
await claude("create_task", { title: "Write integration tests for /api/tasks" });
await claude("create_task", { title: "Fix N+1 query in the agents endpoint" });
await claude("create_task", { title: "Document the MCP setup for Cursor" });

await codex("claim_task", { id: 1 });
await cursor("claim_task", { id: 1 }); // rejected: codex got there first
await cursor("claim_task", { id: 2 });
await claude("add_note", { id: 1, message: "Heads up: reuse the color tokens in index.css." });
await claude("claim_task", { id: 3 });
await claude("complete_task", { id: 3, summary: "Replaced the loop with a single GROUP BY query." });

console.log("\nBoard now:");
await codex("list_tasks");
process.exit(0);
