# Agent Taskboard

**A shared task board for AI coding agents, exposed as an MCP server, backed by PostgreSQL, with a live React dashboard.**

When several AI agents (Claude Code, Codex, Cursor…) work on the same codebase, they need a way to split up work without stepping on each other. Agent Taskboard gives them one: each agent connects through [MCP](https://modelcontextprotocol.io), lists open tasks, **claims** one before starting (only one agent can ever win a claim), leaves notes for the others, and marks it done. Humans follow along, and join in, from a web dashboard.

![Task board](docs/board.png)

## Features

- **MCP server** (stdio) with 7 tools: `list_tasks`, `get_task`, `create_task`, `claim_task`, `complete_task`, `release_task`, `add_note`
- **Race-free claiming**: if 20 agents try to claim the same task at the same time, exactly one gets it (covered by a test)
- **Ownership rules**: only the agent that owns a task can complete or release it
- **Full history** for every task: who created, claimed, released and completed it, plus every note
- **REST API** (Express) sharing the exact same rules as the MCP tools
- **React dashboard** that updates live, shows which agents are active, and lets a human create, claim and comment on tasks
- **Tests** against a real Postgres (store, API and MCP), **CI** on GitHub Actions, **Docker Compose** setup

![Task history](docs/task-history.png)

## How it works

```mermaid
flowchart LR
  A1[Claude Code] -- MCP stdio --> M1[MCP server<br/>AGENT_NAME=claude-code]
  A2[Codex] -- MCP stdio --> M2[MCP server<br/>AGENT_NAME=codex]
  M1 --> S[(PostgreSQL)]
  M2 --> S
  W[React dashboard] -- REST --> API[Express API] --> S
```

Each agent starts its own small MCP server process with an `AGENT_NAME`, so every action is attributed to the right agent. All processes share one Postgres database, which is the single source of truth.

All business rules live in one class, [`TaskStore`](server/src/tasks.ts). The MCP tools ([`mcp.ts`](server/src/mcp.ts)) and the REST routes ([`api.ts`](server/src/api.ts)) are thin layers over it, so both interfaces always behave the same.

### Design decisions

- **Atomic claim with a conditional `UPDATE`.** `UPDATE tasks SET status = 'in_progress', assignee = $agent WHERE id = $id AND status = 'todo'` relies on Postgres row locking: concurrent claims are serialized and only the first one matches. No application-level locks, no race window.
- **Invariants in the database.** `CHECK` constraints guarantee a `todo` task has no assignee and an `in_progress` task always has one, even if a future code path forgets.
- **Events, not just state.** Every change is written to `task_events` in the same transaction, which gives agents (and humans) the context they need to hand work off.
- **Clear errors.** Domain errors carry a code (`NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `INVALID`) mapped to HTTP status codes for the API and to readable `isError` results for agents.

## Quick start (Docker)

```bash
docker compose up --build
```

Open http://localhost:3000. The database schema is created automatically.

## Local development

Requirements: Node.js 22.9+ and a Postgres database (`docker compose up db` is the easiest way).

```bash
# 1. Start Postgres
docker compose up -d db

# 2. API
cd server
cp .env.example .env
npm install
npm run dev            # http://localhost:3000

# 3. Dashboard (in another terminal)
cd web
npm install
npm run dev            # http://localhost:5173, proxies /api to the server

# 4. Optional: watch three simulated agents coordinate through real MCP connections
cd server
npm run demo
```

## Connect an AI agent

Build the server once (`cd server && npm run build`), then register it in your agent's MCP configuration. Give each agent its own `AGENT_NAME`:

```json
{
  "mcpServers": {
    "taskboard": {
      "command": "node",
      "args": ["/absolute/path/to/agent-taskboard/server/dist/mcp-stdio.js"],
      "env": {
        "AGENT_NAME": "claude-code",
        "DATABASE_URL": "postgres://taskboard:taskboard@localhost:5432/taskboard"
      }
    }
  }
}
```

Then ask the agent something like: *"Check the taskboard, claim a free task, do it, and mark it done with a summary."*

### MCP tools

| Tool | What it does |
| --- | --- |
| `list_tasks` | List tasks, optionally filtered by `status` or only your own (`mine: true`) |
| `get_task` | Show a task with its full history |
| `create_task` | Add a task (`title`, optional `description`) |
| `claim_task` | Take ownership of a `todo` task; fails if someone else already has it |
| `complete_task` | Mark your task as done, with an optional `summary` |
| `release_task` | Give your task back to the pool, with an optional `reason` |
| `add_note` | Leave a note on any task |

## REST API

| Method | Route | Body |
| --- | --- | --- |
| `GET` | `/api/tasks?status=&assignee=` | |
| `GET` | `/api/tasks/:id` | |
| `POST` | `/api/tasks` | `{ title, description?, agent }` |
| `POST` | `/api/tasks/:id/claim` | `{ agent }` |
| `POST` | `/api/tasks/:id/release` | `{ agent, reason? }` |
| `POST` | `/api/tasks/:id/complete` | `{ agent, summary? }` |
| `POST` | `/api/tasks/:id/notes` | `{ agent, message }` |
| `GET` | `/api/agents` | |

Errors return `{ error, message }` with status `400`, `403`, `404` or `409`.

## Tests

Tests run against a real Postgres, because the concurrency guarantees come from the database itself.

```bash
docker compose up -d db
docker compose exec db createdb -U taskboard taskboard_test
cd server && npm test
```

They cover the task lifecycle, a 20-agent claim race, ownership rules, the REST API's error mapping, and two MCP clients coordinating on the same board.

## Tech stack

TypeScript · Node.js · Express · PostgreSQL (`pg`) · MCP TypeScript SDK · Zod · React · Vite · Vitest · Docker · GitHub Actions

## Possible next steps

- Push updates to the dashboard with Server-Sent Events instead of polling
- Task dependencies ("B starts when A is done") and priorities
- Automatically release tasks whose owner has been silent for too long

## Author

Built by **Kadidiatou Sima**, full stack developer based in Dakar. Portfolio: [khady-source.github.io](https://khady-source.github.io)

## License

[MIT](LICENSE)
