"use client"

// The client's topic notes, above the Engagements tab: the client page's
// tracker. The prospect page puts the same board under its stage tracker.

import { useEffect, useState } from "react"
import { apiJson } from "../../_tasks/taskClient"
import { TopicNotesBoard, type TopicNote } from "../../_notes/noteUi"

export function ClientTopicNotes({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const [notes, setNotes] = useState<TopicNote[]>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const j = await apiJson<{ notes: TopicNote[] }>(`/api/coach/clients/${clientId}/note-feed`)
        if (alive) setNotes(j.notes ?? [])
      } catch { /* the board is extra: the Notes tab shows its own error */ }
    })()
    return () => { alive = false }
  }, [clientId, refreshKey])
  return (
    <div style={{ marginBottom: 16 }}>
      <TopicNotesBoard
        notes={notes}
        noteHref={(id) => `/dashboard/coach/clients/${clientId}?tab=notes#note-${id}`}
      />
    </div>
  )
}
