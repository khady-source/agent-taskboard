import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Agent, type Task, type TaskStatus } from './api'
import { TaskDetail } from './TaskDetail'
import { timeAgo } from './time'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]

const POLL_MS = 2000

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState(() => readName())

  // The board is shared with AI agents, so poll to show their changes live.
  const refresh = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([api.tasks(), api.agents()])
      setTasks(t)
      setAgents(a)
      setError(null)
    } catch {
      setError('Cannot reach the API. Is the server running?')
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const changeName = (name: string) => {
    setMe(name)
    try { localStorage.setItem('taskboard:name', name) } catch { /* storage unavailable */ }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>✓</span>
          <div>
            <h1>Agent Taskboard</h1>
            <p>Shared task board for AI coding agents, over MCP</p>
          </div>
        </div>
        <label className="me">
          Acting as
          <input value={me} onChange={(e) => changeName(e.target.value)} maxLength={64} />
        </label>
      </header>

      {error && <div className="banner">{error}</div>}

      <main className="layout">
        <section className="board" aria-label="Task board">
          {COLUMNS.map(({ status, label }) => {
            const items = tasks.filter((t) => t.status === status)
            return (
              <div key={status} className={`column column-${status}`}>
                <h2>
                  {label} <span className="count">{items.length}</span>
                </h2>
                {status === 'todo' && <NewTask agent={me} onCreated={refresh} />}
                {items.map((task) => (
                  <button key={task.id} className="card" onClick={() => setSelected(task.id)}>
                    <span className="card-id">#{task.id}</span>
                    <span className="card-title">{task.title}</span>
                    <span className="card-meta">
                      {task.assignee ? <span className="agent-chip">@{task.assignee}</span> : <span>Unassigned</span>}
                      <span>{timeAgo(task.updatedAt)}</span>
                    </span>
                  </button>
                ))}
                {items.length === 0 && status !== 'todo' && <p className="empty">Nothing here yet</p>}
              </div>
            )
          })}
        </section>

        <aside className="agents" aria-label="Agents">
          <h2>Agents</h2>
          {agents.length === 0 && <p className="empty">No agent has connected yet.</p>}
          <ul>
            {agents.map((agent) => (
              <li key={agent.name}>
                <span className={`dot ${isOnline(agent.lastSeen) ? 'online' : ''}`} aria-hidden />
                <span className="agent-name">{agent.name}</span>
                <span className="agent-meta">
                  {agent.activeTasks} active · {timeAgo(agent.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      {selected !== null && (
        <TaskDetail id={selected} agent={me} onClose={() => setSelected(null)} onChange={refresh} />
      )}
    </div>
  )
}

function NewTask({ agent, onCreated }: { agent: string; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await api.create(title, '', agent || 'human')
      setTitle('')
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="new-task" onSubmit={submit}>
      <input
        placeholder="Add a task…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        aria-label="New task title"
      />
      <button disabled={busy || !title.trim()}>Add</button>
    </form>
  )
}

function readName(): string {
  try {
    return localStorage.getItem('taskboard:name') ?? 'human'
  } catch {
    return 'human'
  }
}

const isOnline = (lastSeen: string) => Date.now() - new Date(lastSeen).getTime() < 5 * 60_000
