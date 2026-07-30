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
import { renderTemplate, type MergedTemplate } from "../../../../lib/network-tracker/templates"
import { SAMPLE_CONTACT, droppedVariables } from "./groups"
import { BracketText } from "./brackets"
import { InsertFieldMenu } from "./InsertFieldMenu"

// Shared by the textarea and the highlight layer behind it. Any typography or
// box value that differs between the two shows up as text drifting off its own
// highlight, so they read from one object rather than two matching literals.
const BODY_BOX: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  fontFamily: "inherit", fontSize: 13, lineHeight: "20px",
  borderRadius: 12, padding: "12px 14px",
  whiteSpace: "pre-wrap", wordBreak: "break-word",
  margin: 0,
}

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
  const mirrorRef = useRef<HTMLDivElement | null>(null)

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
      {/* The textarea sits transparent over a highlight layer drawing the same
          text, which is the only way to colour part of an editable body. Both
          share BODY_BOX so the two never drift out of alignment; the caret and
          selection stay the real control's. */}
      <div style={{ position: "relative" }}>
        <div
          ref={mirrorRef}
          aria-hidden
          data-testid="body-highlight"
          style={{
            ...BODY_BOX,
            position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none",
            color: T.TEXT, background: T.GLASS,
            border: `1px solid ${dirty ? T.WRN_BLUE : T.BORDER_SOFT}`,
          }}
        >
          <BracketText text={body} />
          {/* A trailing newline has no line box of its own; this gives it one so
              the highlight does not fall short of the caret on the last line. */}
          {"​"}
        </div>
        <textarea
          ref={taRef}
          data-testid="template-body"
          aria-label="Template body"
          value={body}
          onChange={(e) => setDraft(e.target.value)}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop
          }}
          rows={Math.min(20, Math.max(7, body.split("\n").length + 2))}
          style={{
            ...BODY_BOX,
            display: "block", position: "relative", resize: "vertical",
            color: "transparent", caretColor: T.TEXT, background: "transparent",
            border: "1px solid transparent",
          }}
        />
      </div>

      <InsertFieldMenu onInsert={insert} />

      {dropped.length > 0 && (
        // Between editor and preview, where the eye already is. A warning, never
        // a block — dropping a variable can be exactly what someone means, and
        // refusing the save would just push them to stop editing.
        <div data-testid="dropped-warning" style={{
          background: T.WARNING_BG, border: `1px solid ${T.ORANGE_BORDER}`, borderRadius: 10,
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
        {/* Neutral, not green: green means "they responded" on this function, and
            a save succeeding is not news about a contact. */}
        {notice && <span data-testid="editor-notice" style={{ color: T.MUTED, fontSize: 12, fontWeight: 700 }}>{notice}</span>}
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
        }}><BracketText text={preview.text} /></pre>

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

const ghost: React.CSSProperties = {
  background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0,
}
