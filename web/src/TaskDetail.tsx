import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, type Task, type TaskEvent } from './api'
import { timeAgo } from './time'

const KIND_LABEL: Record<TaskEvent['kind'], string> = {
  created: 'created the task',
  claimed: 'claimed it',
  released: 'released it',
  completed: 'completed it',
  note: 'left a note',
}

interface Props {
  id: number
  agent: string
  onClose: () => void
  onChange: () => void
}

export function TaskDetail({ id, agent, onClose, onChange }: Props) {
  const [task, setTask] = useState<(Task & { events: TaskEvent[] }) | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => api.task(id).then(setTask), [id])

  useEffect(() => {
    load()
    const timer = setInterval(load, 2000)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [load, onClose])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
      onChange()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const submitNote = (e: FormEvent) => {
    e.preventDefault()
    if (!note.trim()) return
    act(async () => {
      await api.note(id, agent, note)
      setNote('')
    })
  }

  const mine = task?.assignee === agent

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={`Task ${id}`} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        {!task ? (
          <p className="empty">Loading…</p>
        ) : (
          <>
            <p className="card-id">#{task.id} · {task.status.replace('_', ' ')}</p>
            <h2>{task.title}</h2>
            {task.description && <p className="description">{task.description}</p>}
            <p className="owner">
              {task.assignee ? <>Assigned to <b>@{task.assignee}</b></> : 'Not assigned'}
            </p>

            <div className="actions">
              {task.status === 'todo' && (
                <button className="primary" onClick={() => act(() => api.claim(id, agent))}>Claim as {agent}</button>
              )}
              {task.status === 'in_progress' && mine && (
                <>
                  <button className="primary" onClick={() => act(() => api.complete(id, agent))}>Mark done</button>
                  <button onClick={() => act(() => api.release(id, agent))}>Release</button>
                </>
              )}
            </div>
            {error && <p className="error">{error}</p>}

            <h3>History</h3>
            <ol className="history">
              {task.events.map((e) => (
                <li key={e.id} className={`event event-${e.kind}`}>
                  <span><b>{e.agent}</b> {KIND_LABEL[e.kind]}</span>
                  <time dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
                  {e.message && <p>{e.message}</p>}
                </li>
              ))}
            </ol>

            <form className="note-form" onSubmit={submitNote}>
              <textarea
                placeholder="Leave a note for other agents…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
              <button disabled={!note.trim()}>Add note</button>
            </form>
          </>
        )}
      </aside>
    </div>
  )
}
