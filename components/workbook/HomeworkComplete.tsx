"use client"

// components/workbook/HomeworkComplete.tsx
//
// "Mark homework complete", at the end of the last homework section of a session
// workbook. Pressing it records the moment and tells the coach; the database
// decides whether this is the first time, so the outside webhook fires once per
// workbook however many times this is pressed.
//
// Answers stay editable afterwards: finishing the homework is not a lock.

import React, { useState } from "react"
import { wbFetch } from "./api"

export function HomeworkComplete({ workbookId, completedAt, coachName, onDone }: {
  workbookId: string
  completedAt: string | null
  coachName: string
  onDone(at: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (completedAt) {
    const d = new Date(completedAt)
    return (
      <div className="wb-callout paleblue" role="status">
        <span className="wb-callout-title">Homework marked complete</span>
        <p className="wb-p" style={{ margin: 0 }}>
          You marked this complete on {d.toLocaleDateString(undefined, { month: "long", day: "numeric" })} at{" "}
          {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. {coachName} has it.
          Watch for an email with your video practice round. You can still change your answers.
        </p>
      </div>
    )
  }

  return (
    <div className="wb-col" style={{ gap: 12 }}>
      <button
        type="button"
        className="wb-btn wb-btn-solid"
        style={{ minHeight: 56, fontSize: 17, alignSelf: "flex-start" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const { status, body } = await wbFetch<{ completed_at: string }>(
            `/api/me/workbooks/${workbookId}/homework-complete`, { method: "POST", body: "{}" },
          )
          setBusy(false)
          if (status !== 200 || !body.completed_at) {
            setError(body.error || "Couldn't mark it complete. Try again.")
            return
          }
          onDone(body.completed_at)
        }}
      >
        {busy ? "Marking complete" : "Mark homework complete"}
      </button>
      <span className="wb-muted" style={{ fontSize: 14 }}>
        Press this once all five questions are answered. It tells {coachName} you are finished.
      </span>
      {error && <span className="wb-warn" role="alert">{error}</span>}
    </div>
  )
}
