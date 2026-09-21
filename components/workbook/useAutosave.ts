"use client"

// components/workbook/useAutosave.ts
//
// Per-field autosave. Each field saves on its own after a short pause, sending
// the updated_at it last saw. A 409 means another tab or device saved first:
// the field shows both versions and the person chooses; nothing is overwritten
// silently. One request per field at a time; typing during a save queues one
// follow-up with the newest value.

import { useCallback, useEffect, useRef, useState } from "react"
import type { AnswerValue } from "../../lib/workbook/content"
import type { SaveState } from "./Blocks"
import { wbFetch } from "./api"

const DELAY_MS = 700

export function useAutosave(workbookId: string, initial: Record<string, { value: unknown; updated_at: string }>) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(Object.entries(initial).map(([k, a]) => [k, a.value])),
  )
  const [states, setStates] = useState<Record<string, SaveState>>({})
  const base = useRef<Record<string, string | null>>(
    Object.fromEntries(Object.entries(initial).map(([k, a]) => [k, a.updated_at])),
  )
  const latest = useRef<Record<string, unknown>>({ ...values })
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const inflight = useRef<Record<string, boolean>>({})
  const dirty = useRef<Record<string, boolean>>({})
  // Keys with a clash on screen, and the other version. A ref, so timers and
  // handlers read it without side effects inside state updaters.
  const conflicts = useRef<Record<string, unknown>>({})

  const setState = (k: string, s: SaveState) => setStates((p) => ({ ...p, [k]: s }))

  // The latest save, for the follow-up save queued inside save() itself and for
  // the unmount flush below.
  const saveRef = useRef<(k: string) => Promise<void>>(async () => {})

  const save = useCallback(async (k: string) => {
    if (inflight.current[k]) { dirty.current[k] = true; return }
    inflight.current[k] = true
    dirty.current[k] = false
    setState(k, { kind: "saving" })
    const { status, body } = await wbFetch<{ answer?: { updated_at: string }; current?: { value: unknown; updated_at: string } | null }>(
      `/api/me/workbooks/${workbookId}/answers/${encodeURIComponent(k)}`,
      { method: "PUT", body: JSON.stringify({ value: latest.current[k], expected_updated_at: base.current[k] ?? null }) },
    )
    inflight.current[k] = false
    if (status === 200 && body.answer) {
      base.current[k] = body.answer.updated_at
      if (dirty.current[k]) { void saveRef.current(k); return }
      setState(k, { kind: "saved" })
      return
    }
    if (status === 409) {
      base.current[k] = body.current?.updated_at ?? null
      dirty.current[k] = false
      conflicts.current[k] = body.current?.value ?? ""
      setState(k, { kind: "conflict", theirs: conflicts.current[k] })
      return
    }
    setState(k, { kind: "error", message: body.error || "Not saved. Check your connection." })
  }, [workbookId])

  const set = useCallback((k: string, v: AnswerValue) => {
    latest.current[k] = v
    setValues((p) => ({ ...p, [k]: v }))
    // While a clash is on screen, hold the save until the person chooses.
    if (k in conflicts.current) return
    setState(k, { kind: "saving" })
    clearTimeout(timers.current[k])
    timers.current[k] = setTimeout(() => { delete timers.current[k]; void save(k) }, DELAY_MS)
  }, [save])

  /** Save a value now (checklist ticks), bypassing the typing pause. */
  const setNow = useCallback((k: string, v: AnswerValue) => {
    latest.current[k] = v
    setValues((p) => ({ ...p, [k]: v }))
    void save(k)
  }, [save])

  const resolveConflict = useCallback((k: string, keep: "theirs" | "mine") => {
    if (!(k in conflicts.current)) return
    const theirs = conflicts.current[k]
    delete conflicts.current[k]
    if (keep === "theirs") {
      latest.current[k] = theirs
      setValues((vs) => ({ ...vs, [k]: theirs }))
      setState(k, { kind: "saved" })
      return
    }
    void save(k)
  }, [save])

  /** Apply a value the server already wrote (an accepted suggestion). */
  const applyServer = useCallback((k: string, value: unknown, updatedAt: string) => {
    latest.current[k] = value
    base.current[k] = updatedAt
    setValues((p) => ({ ...p, [k]: value }))
    setState(k, { kind: "saved" })
  }, [])

  const busy = Object.values(states).some((s) => s.kind === "saving")

  // Leaving mid-pause: send what is waiting rather than dropping it, and ask the
  // browser to hold the tab while a save is still out.
  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => {
    const t = timers.current
    return () => {
      for (const k of Object.keys(t)) { clearTimeout(t[k]); void saveRef.current(k) }
    }
  }, [])
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy])

  const failed = Object.values(states).some((s) => s.kind === "error" || s.kind === "conflict")

  return { values, states, set, setNow, resolveConflict, applyServer, busy, failed }
}
