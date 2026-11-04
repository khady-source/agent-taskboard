// Types mirror the server's TaskStore (server/src/tasks.ts).

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  assignee: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface TaskEvent {
  id: number
  agent: string
  kind: 'created' | 'claimed' | 'released' | 'completed' | 'note'
  message: string
  createdAt: string
}

export interface Agent {
  name: string
  lastSeen: string
  activeTasks: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status})`)
  return body as T
}

const post = <T,>(path: string, data: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(data) })

export const api = {
  tasks: () => call<Task[]>('/tasks'),
  task: (id: number) => call<Task & { events: TaskEvent[] }>(`/tasks/${id}`),
  agents: () => call<Agent[]>('/agents'),
  create: (title: string, description: string, agent: string) =>
    post<Task>('/tasks', { title, description, agent }),
  claim: (id: number, agent: string) => post<Task>(`/tasks/${id}/claim`, { agent }),
  release: (id: number, agent: string) => post<Task>(`/tasks/${id}/release`, { agent }),
  complete: (id: number, agent: string) => post<Task>(`/tasks/${id}/complete`, { agent }),
  note: (id: number, agent: string, message: string) =>
    post<TaskEvent>(`/tasks/${id}/notes`, { agent, message }),
}
