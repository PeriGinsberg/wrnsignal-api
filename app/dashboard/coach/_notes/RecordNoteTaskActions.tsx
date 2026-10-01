"use client"

// The record's two buttons, Add Note and Add Task, for the pages keyed by the
// relationship (coach_clients.id): the prospect page and the converted-client
// page. The client page has the same pair in ClientHeaderStrip, keyed by the
// client's profile.
//
// Add Note opens the shared slide-in panel (type + topic) and posts to
// /api/coach/prospects/[id]/notes, which serves any lifecycle. Add Task opens
// the task form fixed to this relationship, offering only the coaches who can
// open it (anyone else is refused on save).

import { useEffect, useState, type ReactNode } from "react"
import { T, btnSecondary } from "../../../../lib/dashboard-theme"
import { TaskFormModal } from "../_tasks/TaskFormModal"
import { apiJson, type Assignee } from "../_tasks/taskClient"
import { AddNotePanel, type NoteSubmitInput } from "../clients/[clientId]/AddNotePanel"

/** Tomorrow noon local, as an ISO instant: the task form's default due date. */
function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(12, 0, 0, 0)
  return d.toISOString()
}

const headerButton = {
  ...btnSecondary,
  fontSize: 12,
  padding: "8px 14px",
  color: T.INK_EMPHASIS,
  borderColor: "rgba(254,176,106,0.3)",
}

export type RecordNoteTaskOptions = {
  /** coach_clients.id */
  coachClientId: string
  /** Shown on the task form's fixed client field. */
  name: string
  /** What the task form calls the record: "Prospect" or "Client". */
  recordLabel: string
  /** After a note saves, so the page re-reads its notes. */
  onNoteSaved: () => void
  /** After a task saves, so the page's Tasks section re-reads. */
  onTaskSaved: () => void
}

/**
 * The buttons and the panel/form they open.
 *
 * Returns `openNote` as well as the element, so a page's own "+ Add note"
 * (in its Notes section) opens the same panel rather than a second form.
 */
export function useRecordNoteTaskActions(opts: RecordNoteTaskOptions): { openNote: () => void; element: ReactNode } {
  const { coachClientId, name, recordLabel, onNoteSaved, onTaskSaved } = opts
  const [noteOpen, setNoteOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [me, setMe] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const j = await apiJson<{ assignees: Assignee[]; me: string }>(
          `/api/coach/tasks/assignees?coach_client_id=${encodeURIComponent(coachClientId)}`)
        if (!alive) return
        setAssignees(j.assignees ?? [])
        setMe(j.me ?? null)
      } catch { /* the form falls back to me, which the server defaults to */ }
    })()
    return () => { alive = false }
  }, [coachClientId])

  async function submitNote(input: NoteSubmitInput) {
    try {
      await apiJson(`/api/coach/prospects/${coachClientId}/notes`, { method: "POST", body: JSON.stringify(input) })
      return { ok: true as const }
    } catch (e: any) {
      return { ok: false as const, error: e?.message || "Couldn't save note" }
    }
  }

  const element = (
    <>
      <button type="button" onClick={() => setNoteOpen(true)} style={headerButton}>Add Note</button>
      <button type="button" onClick={() => setTaskOpen(true)} style={headerButton}>Add Task</button>
      {taskOpen && (
        <TaskFormModal
          task={null}
          assignees={assignees}
          clients={[]}
          presetCoachClient={{ id: coachClientId, name, label: recordLabel }}
          presetAssigneeId={me ?? undefined}
          presetDueAt={tomorrowIso()}
          onClose={() => setTaskOpen(false)}
          onSaved={onTaskSaved}
        />
      )}
      <AddNotePanel
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSaved={onNoteSaved}
        onSubmit={submitNote}
      />
    </>
  )
  return { openNote: () => setNoteOpen(true), element }
}
