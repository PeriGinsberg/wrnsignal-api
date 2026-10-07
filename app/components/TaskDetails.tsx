"use client"

// A task's details: collapsed by default behind a "Details" toggle, on the
// library task (Settings), the client's plan task (Plan), the To-Do item and
// the client's Coaching Hub. Plain text; a line starting with -, * or a bullet
// shows as a checklist item, everything else as written.
//
// Read-only unless onSave is given. With no details: nothing at all when
// read-only, an "Add details" link when editable.

import { useState } from "react"
import { DETAILS_MAX } from "@/lib/plan/model"

const BULLET = /^\s*(?:[-*•]|\[\s?[xX]?\s?\])\s+/

export function DetailsText({ text, ink }: { text: string; ink: string }) {
  const lines = text.split(/\r?\n/)
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    out.push(
      <ul key={`l${out.length}`} style={{ margin: "2px 0", paddingLeft: 20 }}>
        {list.map((l, i) => <li key={i} style={{ margin: "2px 0" }}>{l}</li>)}
      </ul>,
    )
    list = []
  }
  for (const line of lines) {
    if (BULLET.test(line)) { list.push(line.replace(BULLET, "")); continue }
    flush()
    if (line.trim()) out.push(<p key={`p${out.length}`} style={{ margin: "2px 0" }}>{line}</p>)
  }
  flush()
  return <div style={{ color: ink, fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}>{out}</div>
}

export function TaskDetails({
  details, ink, accent, onSave, disabled, label = "Details", taskName, extra,
}: {
  details: string | null | undefined
  /** Text colour. */
  ink: string
  /** The toggle's colour. */
  accent: string
  /** Makes it editable. Resolve true when saved. */
  onSave?: (details: string | null) => Promise<boolean>
  disabled?: boolean
  label?: string
  /** For screen readers: which task these details belong to. */
  taskName?: string
  /** Shown under the text when open, e.g. an "Edit in Plan" link. */
  extra?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const has = !!details?.trim()
  if (!has && !onSave) return null

  const link: React.CSSProperties = {
    background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
    fontSize: 13, fontWeight: 700, color: accent,
  }
  const startEdit = () => { setDraft(details ?? ""); setEditing(true); setOpen(true) }

  if (editing) {
    return (
      <div style={{ width: "100%", marginTop: 4 }}>
        <textarea aria-label={`${label}${taskName ? ` for ${taskName}` : ""}`} value={draft} maxLength={DETAILS_MAX} rows={5}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"What this task involves. One checklist item per line, starting with -"}
          style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, color: ink,
            padding: "8px 10px", borderRadius: 8, border: "1px solid #C9D6E3", background: "#fff", resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <button type="button" disabled={saving || disabled}
            onClick={async () => {
              setSaving(true)
              const ok = await onSave!(draft.trim() ? draft : null)
              setSaving(false)
              if (ok) setEditing(false)
            }}
            style={{ background: "#08203F", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px",
              fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" style={link} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <span style={{ marginLeft: "auto", fontSize: 12, color: ink, opacity: 0.7 }}>{draft.length}/{DETAILS_MAX}</span>
        </div>
      </div>
    )
  }

  if (!has) {
    return <button type="button" style={link} disabled={disabled} onClick={startEdit}>+ Add details</button>
  }

  return (
    <div style={{ width: "100%" }}>
      <button type="button" style={link} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true" style={{ display: "inline-block", width: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
        {label}
      </button>
      {open && (
        <div style={{ marginTop: 4, paddingLeft: 12, borderLeft: `2px solid ${accent}` }}>
          <DetailsText text={details!} ink={ink} />
          {(onSave || extra) && (
            <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
              {onSave && <button type="button" style={link} disabled={disabled} onClick={startEdit}>Edit</button>}
              {extra}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
