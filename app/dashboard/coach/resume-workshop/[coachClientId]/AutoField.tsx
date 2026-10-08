"use client"

// One autosaving text field for the Resume Workshop.
//
// HOW A SAVE WORKS. Typing waits 800 ms of quiet, then saves. Only one save per
// field is ever in flight; text typed during a save is saved straight after it,
// against the version the first save returned. So this field can never send a
// stale value over its own newer one.
//
// ANOTHER WINDOW SAVED FIRST. The server refuses a save typed against an old
// version and returns what it has. The field then shows both choices: keep
// what is on this screen (saved over the other), or take the other version.
// Nothing is silently lost either way: every accepted save is in history.
//
// The page keeps a registry of fields so it can show one overall status, flush
// everything before an export, and warn before leaving with unsaved text.

import { useCallback, useEffect, useRef, useState } from "react"
import { T } from "../../../../../lib/dashboard-theme"

export type SaveResult = { ok: true; value: string; version: number } | { ok: false; status: number; error: string; current?: { value: string; version: number } | null }
export type FieldStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict"

export type Registry = {
  register: (id: string, f: { flush: () => Promise<void> }) => void
  unregister: (id: string) => void
  report: (id: string, s: FieldStatus) => void
}

export function AutoField({
  id, value, version, revision, save, registry, multiline, placeholder, minRows = 3, ariaLabel, style, autoFocus, onKeyDown,
}: {
  id: string
  value: string
  version: number
  /** Bump to make the field adopt value/version from outside (e.g. a note appended by Move). */
  revision?: number
  save: (value: string, baseVersion: number) => Promise<SaveResult>
  registry: Registry
  multiline?: boolean
  placeholder?: string
  minRows?: number
  ariaLabel: string
  style?: React.CSSProperties
  autoFocus?: boolean
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void
}) {
  const [text, setText] = useState(value)
  const [status, setStatus] = useState<FieldStatus>("idle")
  const [conflict, setConflict] = useState<{ value: string; version: number } | null>(null)
  const textRef = useRef(value)
  const baseRef = useRef(version)
  const savedRef = useRef(value)
  const inflight = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const statusRef = useRef<FieldStatus>("idle")

  const set = useCallback((s: FieldStatus) => { statusRef.current = s; setStatus(s); registry.report(id, s) }, [id, registry])
  // The latest save function, so a parent re-render (which makes a new one)
  // never re-creates run/flush or re-registers this field and loses its status.
  const saveRef = useRef(save)
  saveRef.current = save

  // Adopt an outside change only when nothing local is waiting to be saved.
  useEffect(() => {
    if (revision === undefined) return
    if (textRef.current === savedRef.current && !inflight.current) {
      textRef.current = value; savedRef.current = value; baseRef.current = version
      setText(value)
    } else {
      baseRef.current = Math.max(baseRef.current, version)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  const conflictRef = useRef(false)

  const run = useCallback(async (): Promise<void> => {
    while (inflight.current) await inflight.current
    if (conflictRef.current) return
    const snapshot = textRef.current
    if (snapshot === savedRef.current) { set("saved"); return }
    set("saving")
    let saved = false
    const p = (async () => {
      const r = await saveRef.current(snapshot, baseRef.current).catch((e): SaveResult => ({ ok: false, status: 0, error: String(e?.message ?? e) }))
      if (r.ok) {
        baseRef.current = r.version
        savedRef.current = snapshot
        saved = true
        set(textRef.current === snapshot ? "saved" : "pending")
      } else if (r.status === 409 && r.current) {
        conflictRef.current = true
        setConflict(r.current)
        set("conflict")
      } else {
        set("error")
      }
    })()
    inflight.current = p
    await p
    inflight.current = null
    // Typed during the save: save again now, on the version just returned.
    if (saved && textRef.current !== savedRef.current) return run()
  }, [set])

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (inflight.current) await inflight.current
    if (textRef.current !== savedRef.current) await run()
  }, [run])

  useEffect(() => {
    registry.register(id, { flush })
    registry.report(id, statusRef.current)
    return () => registry.unregister(id)
  }, [id, flush, registry])

  // Retry an error once after a pause (a dropped connection mid-session).
  useEffect(() => {
    if (status !== "error") return
    const t = setTimeout(() => { if (textRef.current !== savedRef.current) void run() }, 4000)
    return () => clearTimeout(t)
  }, [status, run])

  const grow = () => {
    const el = areaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }
  useEffect(grow, [text])

  const onChange = (v: string) => {
    textRef.current = v
    setText(v)
    if (conflictRef.current) return
    set("pending")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void run() }, 800)
  }

  const keepMine = async () => {
    if (!conflict) return
    baseRef.current = conflict.version
    conflictRef.current = false
    setConflict(null)
    set("pending")
    await run()
  }
  const useTheirs = () => {
    if (!conflict) return
    textRef.current = conflict.value; savedRef.current = conflict.value; baseRef.current = conflict.version
    setText(conflict.value)
    conflictRef.current = false
    setConflict(null)
    set("saved")
  }

  const common = {
    value: text,
    "aria-label": ariaLabel,
    placeholder,
    autoFocus,
    onBlur: () => { void flush() },
    style: {
      width: "100%", boxSizing: "border-box" as const, fontFamily: "inherit", color: T.TEXT,
      background: T.CARD, border: `1px solid ${status === "error" || status === "conflict" ? T.ERROR : T.BORDER}`,
      borderRadius: 10, padding: multiline ? "10px 12px" : "8px 12px", outline: "none",
      ...style,
    },
  }

  return (
    <div style={{ width: "100%" }}>
      {multiline ? (
        <textarea {...common} ref={areaRef} rows={minRows}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLTextAreaElement> | undefined}
          style={{ ...common.style, resize: "vertical", lineHeight: 1.55, fontSize: 16, minHeight: `${minRows * 1.55 + 1.4}em`, overflow: "hidden" }} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLInputElement> | undefined} />
      )}
      {conflict && (
        <div role="alert" style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: T.ERROR_BG, color: T.TEXT, fontSize: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span>This was changed in another window.</span>
          <button type="button" onClick={() => void keepMine()} style={linkBtn}>Keep what is here</button>
          <button type="button" onClick={useTheirs} style={linkBtn}>Use the other version</button>
        </div>
      )}
      {status === "error" && !conflict && (
        <div role="alert" style={{ marginTop: 6, fontSize: 13, color: T.ERROR, display: "flex", gap: 10, alignItems: "center" }}>
          Not saved yet. Retrying.
          <button type="button" onClick={() => void run()} style={linkBtn}>Retry now</button>
        </div>
      )}
    </div>
  )
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
  fontSize: 14, fontWeight: 800, color: "inherit", textDecoration: "underline",
}
