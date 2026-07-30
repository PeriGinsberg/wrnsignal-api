"use client"

// The 8e editor, lifted out of page.tsx unchanged in behaviour and re-laid from
// three columns to a vertical stack so it fits inside an expanded card: body,
// palette, warning, actions, preview.
//
// Saving is the existing PATCH; "revert to default" is the existing DELETE (no
// row IS the default). Saving the default back verbatim is treated as a revert
// by the route, so a client who edits and undoes is not left permanently marked
// as customised.
//
// Draft state lives HERE rather than in the page, which is what implements
// discard-on-switch: collapsing a card unmounts the editor and the unsaved edit
// goes with it, the same rule the rail had when it swapped templates.

import { useCallback, useMemo, useRef, useState } from "react"
import { T, card, fieldLabel, btnPrimary } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import {
  renderTemplate, extractVariables, classifyVariable, DEFAULTS_BY_ID,
  type MergedTemplate,
} from "../../../../lib/network-tracker/templates"
import { SAMPLE_CONTACT, droppedVariables } from "./groups"

export function TemplateEditor({
  id, template, profile, onReload,
}: {
  id: string
  template: MergedTemplate | null
  profile: Record<string, string | null> | null
  onReload: () => Promise<void>
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "save" | "revert">(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const body = draft ?? template?.body ?? ""
  const dirty = draft !== null && template != null && draft !== template.body
  const dropped = useMemo(() => (dirty ? droppedVariables(id, body) : []), [dirty, id, body])
  const preview = useMemo(() => renderTemplate(body, profile, SAMPLE_CONTACT), [body, profile])

  // Palette insert at the caret, so nobody types a bracket by hand.
  const insert = useCallback((token: string) => {
    const ta = taRef.current
    const text = `[${token}]`
    if (!ta) { setDraft((d) => (d ?? template?.body ?? "") + text); return }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? start
    const current = ta.value
    const next = current.slice(0, start) + text + current.slice(end)
    setDraft(next)
    // Put the caret after what we just inserted rather than at the end, so a
    // second insert does not land somewhere the writer is not looking.
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + text.length, start + text.length)
    })
  }, [template])

  async function save() {
    if (!template || !dirty) return
    setBusy("save"); setError(null); setNotice(null)
    try {
      const res = await authFetch(`/api/network/templates/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      setDraft(null)
      await onReload()
      // The route turns "saved the default back" into a revert; say which
      // happened — without naming the template by its code.
      setNotice(j?.reverted ? "Back to the default." : "Saved.")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function revert() {
    if (!template) return
    setBusy("revert"); setError(null); setNotice(null)
    try {
      const res = await authFetch(`/api/network/templates/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Revert failed (${res.status})`)
      setDraft(null)
      await onReload()
      setNotice("Back to the default.")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="template-editor" style={{ marginTop: 12 }}>
      <textarea
        ref={taRef}
        data-testid="template-body"
        aria-label="Template body"
        value={body}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(20, Math.max(7, body.split("\n").length + 2))}
        style={{
          display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
          fontFamily: "inherit", fontSize: 13, lineHeight: "20px", color: T.TEXT,
          background: T.GLASS, border: `1px solid ${dirty ? T.WRN_BLUE : T.BORDER_SOFT}`,
          borderRadius: 12, padding: "12px 14px",
        }}
      />

      <Palette onInsert={insert} />

      {dropped.length > 0 && (
        // Between editor and preview, where the eye already is. A warning, never
        // a block — dropping a variable can be exactly what someone means, and
        // refusing the save would just push them to stop editing.
        <div data-testid="dropped-warning" style={{
          background: T.WARNING_BG, border: "1px solid rgba(254,176,106,0.35)", borderRadius: 10,
          padding: "9px 12px", marginTop: 12, color: T.TEXT, fontSize: 12, lineHeight: "18px",
        }}>
          This drops {dropped.map((v) => `[${v}]`).join(", ")}, which the default filled in
          automatically. Fine if you meant it — but check the preview for anything you have
          written in by hand.
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => void save()} disabled={!dirty || busy !== null}
          style={{ ...btnPrimary, padding: "9px 16px", fontSize: 12.5, opacity: dirty ? 1 : 0.45 }}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {dirty && <button onClick={() => setDraft(null)} style={ghost} data-testid="discard">Discard changes</button>}
        {template?.source === "override" && !dirty && (
          <button onClick={() => void revert()} disabled={busy !== null} style={ghost} data-testid="revert">
            {busy === "revert" ? "Reverting…" : "Revert to default"}
          </button>
        )}
        {notice && <span data-testid="editor-notice" style={{ color: T.SUCCESS, fontSize: 12, fontWeight: 700 }}>{notice}</span>}
        {error && <span data-testid="editor-error" style={{ color: T.ERROR, fontSize: 12 }}>{error}</span>}
      </div>

      {/* The nuance that used to be a paragraph at the top of the screen, now
          where it is actually needed: at the moment of editing. */}
      <p style={{ color: T.DIM, fontSize: 11.5, marginTop: 10, lineHeight: "17px" }}>
        This changes every future message of this kind. To change one message for one person,
        edit it in the Send panel on their record instead.
      </p>

      {/* ── PREVIEW, now stacked below rather than a third column ── */}
      <div style={{ ...card, padding: "14px 16px", marginTop: 14 }}>
        <div style={{ ...fieldLabel, textTransform: "uppercase", marginBottom: 4 }}>Preview</div>
        <div style={{ color: T.DIM, fontSize: 11.5, marginBottom: 10 }}>
          Your profile, sample contact: {SAMPLE_CONTACT.display}
        </div>
        <pre data-testid="preview" style={{
          whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: "20px",
          color: T.TEXT, background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
          borderRadius: 12, padding: "12px 14px", margin: 0,
        }}>{preview.text}</pre>

        {preview.unresolved.length > 0 && (
          <p data-testid="preview-unresolved" style={{ color: T.MUTED, fontSize: 11.5, marginTop: 10, lineHeight: "17px" }}>
            Blank in the preview because your profile has no value yet:{" "}
            {preview.unresolved.map((v) => `[${v}]`).join(", ")}.
          </p>
        )}
        {preview.toFill.length > 0 && (
          <p data-testid="preview-tofill" style={{ color: T.MUTED, fontSize: 11.5, marginTop: 8, lineHeight: "17px" }}>
            Left for you to write at send time: {preview.toFill.map((v) => `[${v}]`).join(", ")}.
          </p>
        )}
      </div>
    </div>
  )
}

// Grouped by where the value comes from, because that is the distinction that
// matters when writing: two of these fill themselves in and one never will.
function Palette({ onInsert }: { onInsert: (token: string) => void }) {
  const groups = useMemo(() => {
    // Derived from the DEFAULTS, so a variable used by a template can never be
    // missing from the palette that is supposed to offer it.
    const all = new Set<string>()
    for (const d of Object.values(DEFAULTS_BY_ID)) extractVariables(d.body).forEach((v) => all.add(v))
    const out: Record<"profile" | "contact" | "fill", string[]> = { profile: [], contact: [], fill: [] }
    for (const v of all) out[classifyVariable(v)].push(v)
    for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort()
    return out
  }, [])

  const SECTIONS = [
    { key: "profile" as const, label: "From your profile" },
    { key: "contact" as const, label: "From the contact" },
    { key: "fill" as const, label: "Fill in when you send" },
  ]

  return (
    <div style={{ marginTop: 12 }} data-testid="palette">
      {SECTIONS.map(({ key, label }) => (
        <div key={key} style={{ marginBottom: 8 }}>
          <div style={{ ...fieldLabel, textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {groups[key].map((v) => (
              <button key={v} onClick={() => onInsert(v)} data-testid={`chip-${v}`} title={`Insert [${v}]`}
                style={{
                  background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, borderRadius: 7,
                  padding: "4px 8px", fontSize: 11, fontWeight: 700, color: T.MUTED, cursor: "pointer",
                  fontFamily: "inherit",
                }}>
                [{v}]
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const ghost: React.CSSProperties = {
  background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0,
}
