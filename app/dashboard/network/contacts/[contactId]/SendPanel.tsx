"use client"

// Phase 8d — copy and mark as sent. The button that closes the loop.
//
// SIGNAL never sends anything; the user pastes into Gmail or LinkedIn. The risk
// is therefore the GAP between composing and logging — a client writes the
// message, sends it, and forgets to record it, so the tracker keeps nagging and
// the due date is wrong. One button removes the gap.
//
// It composes the three pieces built in 8a-8c: pickTemplate chooses the template
// for this contact's current state, the stored body (override or default)
// supplies the wording, and renderTemplate fills it in.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, card, btnPrimary, btnSecondary, fieldLabel, select as selectStyle, selectOption } from "../../../../../lib/dashboard-theme"
import { authFetch } from "../../authFetch"
import { pickTemplate, REASON_TO_ACTION, ACTION_TYPE_LABEL } from "../../vocab"
import { renderTemplate, extractVariables, classifyVariable, UNRESOLVED_PLACEHOLDER, type MergedTemplate } from "../../../../../lib/network-tracker/templates"

type Contact = {
  id: string
  first_name: string
  last_name?: string | null
  relationship?: string | null
  stage?: string | null
  next_due_reason?: string | null
  additional_info?: string | null
  network_companies?: { name: string } | null
}

export function SendPanel({ contact, onLogged }: { contact: Contact; onLogged?: () => void }) {
  const [templates, setTemplates] = useState<MergedTemplate[]>([])
  const [profile, setProfile] = useState<Record<string, string | null> | null>(null)
  const [loading, setLoading] = useState(true)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "send" | "copy">(null)
  // Per-contact scratchpad. null = untouched, so the box shows the freshly
  // rendered template. EPHEMERAL BY DESIGN: this is a place to add one specific
  // line for one specific person before pasting, not a saved customisation.
  // Anything worth keeping belongs in the template itself (8a), which is a
  // different action with a different blast radius — editing the template
  // changes every future message, editing here changes exactly one.
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [tRes, pRes] = await Promise.all([
          authFetch("/api/network/templates"),
          authFetch("/api/network/profile"),
        ])
        const [tj, pj] = await Promise.all([tRes.json().catch(() => ({})), pRes.json().catch(() => ({}))])
        if (!alive) return
        if (tj?.ok) setTemplates(tj.templates ?? [])
        if (pj?.ok) setProfile(pj.profile ?? {})
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // The suggestion, and the user's override of it. null from pickTemplate is a
  // real answer (S1/S5 moments, or a first message with no relationship set) —
  // it means "no suggestion", not "no template", so the picker is offered.
  const suggestedId = useMemo(() => pickTemplate(contact), [contact])
  const activeId = chosenId ?? suggestedId
  const active = templates.find((t) => t.template_id === activeId) ?? null

  // Discard the draft whenever the underlying message changes out from under it.
  // Keeping it would silently paste an edit written against a DIFFERENT template
  // or a different person — the worst possible failure for a copy-paste tool.
  useEffect(() => { setDraft(null) }, [chosenId, suggestedId, contact.id])

  const rendered = useMemo(() => {
    if (!active) return null
    return renderTemplate(active.body, profile, {
      first_name: contact.first_name,
      company_name: contact.network_companies?.name ?? null,
      additional_info: contact.additional_info ?? null,
    })
  }, [active, profile, contact])

  // Same derivation as the inline Log button (ContactRow), deliberately: the two
  // must log the same action for the same due reason or the pipeline disagrees
  // with itself depending on which button the user happened to press.
  // What is actually in the box, and therefore what gets copied.
  const messageText = draft ?? rendered?.text ?? ""
  const isEdited = draft !== null && rendered != null && draft !== rendered.text

  // Warnings track the EDITED text, not the original render. Filling in
  // [MUTUAL] by hand must clear its warning, and typing a raw [CITY] back in
  // must raise one — otherwise the warning describes a message the user is no
  // longer sending.
  const gapsNow = useMemo(() => {
    const brackets = extractVariables(messageText)
    const toFill = brackets.filter((v) => classifyVariable(v) === "fill")
    // A non-fill bracket in the box means the user typed one back in by hand.
    const typedBack = brackets.filter((v) => classifyVariable(v) !== "fill")
    // The named unresolved variables stay useful only while their blanks remain;
    // once the user has typed over every "_____" there is nothing left to warn about.
    const stillBlank = messageText.includes(UNRESOLVED_PLACEHOLDER) ? (rendered?.unresolved ?? []) : []
    return { unresolved: [...stillBlank, ...typedBack], toFill }
  }, [messageText, rendered])

  const reason = contact.next_due_reason ?? null
  const actionType = reason ? (REASON_TO_ACTION[reason] ?? "note_logged") : null

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  const copyOnly = useCallback(async () => {
    if (!rendered) return
    setBusy("copy"); setError(null); setConfirmation(null)
    const okCopy = await copyText(messageText)
    setBusy(null)
    if (!okCopy) { setError("Could not reach the clipboard — select the message and copy manually."); return }
    setConfirmation("Copied. Nothing logged — mark it sent when you've actually sent it.")
  }, [rendered, messageText])

  const copyAndSend = useCallback(async () => {
    if (!rendered || !actionType) return
    setBusy("send"); setError(null); setConfirmation(null)
    // Copy FIRST. If the clipboard fails we must not log an outreach that never
    // left the building — a false "sent" is worse than a failed copy, because it
    // silently advances the due date and the contact goes quiet in the tracker.
    const okCopy = await copyText(messageText)
    if (!okCopy) {
      setBusy(null)
      setError("Could not reach the clipboard — nothing was logged. Copy manually, then use Log.")
      return
    }
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: actionType, action_date: new Date().toISOString() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Logged failed (${res.status})`)
      setConfirmation(`Copied, and logged as ${ACTION_TYPE_LABEL[actionType] ?? actionType}.`)
      onLogged?.()
    } catch (e: unknown) {
      // The copy already happened, so say so rather than implying nothing did.
      setError(`Copied, but logging failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }, [rendered, messageText, actionType, contact.id, onLogged])

  if (loading) return <div style={{ color: T.DIM, fontSize: 12 }}>Loading templates…</div>

  const gaps = rendered ? [...gapsNow.unresolved, ...gapsNow.toFill] : []

  return (
    <div style={{ ...card, padding: "16px 18px" }} data-testid="send-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ ...fieldLabel, textTransform: "uppercase", margin: 0 }}>Send</h2>
        {active && <span style={{ color: T.MUTED, fontSize: 12 }} data-testid="active-template">
          {active.template_id} · {active.label}
        </span>}
      </div>

      {!suggestedId && !chosenId && (
        // Not an error state. S1/S5 have no due reason that implies them, and a
        // first message needs a relationship to choose a family.
        <p style={{ color: T.MUTED, fontSize: 12, margin: "0 0 10px" }}>
          {contact.relationship
            ? "No suggested template for this moment — pick one below."
            : "Set a relationship to get a suggested template, or pick one below."}
        </p>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        <span style={fieldLabel}>Template</span>
        <select
          value={activeId ?? ""}
          onChange={(e) => setChosenId(e.target.value || null)}
          aria-label="Template"
          style={{ ...selectStyle, height: 34, fontSize: 12, width: "100%", maxWidth: 420 }}
        >
          <option value="" style={selectOption}>Choose a template…</option>
          {templates.map((t) => (
            <option key={t.template_id} value={t.template_id} style={selectOption}>
              {t.template_id} · {t.label}{t.source === "override" ? " (edited)" : ""}
            </option>
          ))}
        </select>
      </label>

      {rendered && (
        <>
          <textarea
            data-testid="rendered-message"
            aria-label="Message"
            value={messageText}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck
            rows={Math.min(24, Math.max(6, messageText.split("\n").length + 1))}
            style={{
              display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
              whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, lineHeight: "20px",
              color: T.TEXT, background: T.GLASS, border: `1px solid ${isEdited ? T.WRN_BLUE : T.BORDER_SOFT}`,
              borderRadius: 12, padding: "12px 14px", margin: "0 0 6px",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 20, marginBottom: 10 }}>
            {isEdited && (
              <>
                <span style={{ color: T.MUTED, fontSize: 11.5 }} data-testid="edited-note">
                  Edited for {contact.first_name} — this copy only, not saved to the template.
                </span>
                <button
                  onClick={() => setDraft(null)}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: T.WRN_BLUE, fontSize: 11.5, fontWeight: 700, textDecoration: "underline",
                  }}
                >
                  Revert to suggestion
                </button>
              </>
            )}
          </div>

          {gaps.length > 0 && (
            // Warn, never block. Someone may well finish the sentence in Gmail,
            // and refusing to copy would just push them to retype it by hand.
            <div
              data-testid="gap-warning"
              style={{
                background: T.WARNING_BG, border: `1px solid rgba(254,176,106,0.35)`,
                borderRadius: 10, padding: "9px 12px", marginBottom: 12,
                color: T.TEXT, fontSize: 12, lineHeight: "18px",
              }}
            >
              {gapsNow.unresolved.length > 0 && (
                <div>
                  Still unfilled: {gapsNow.unresolved.map((v) => `[${v}]`).join(", ")} — fill your
                  networking profile, or edit before sending.
                </div>
              )}
              {gapsNow.toFill.length > 0 && (
                <div style={{ marginTop: gapsNow.unresolved.length ? 4 : 0 }}>
                  Fill in {gapsNow.toFill.map((v) => `[${v}]`).join(", ")} before sending — these
                  are yours to write.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {actionType ? (
              <button onClick={() => void copyAndSend()} disabled={busy !== null}
                style={{ ...btnPrimary, padding: "10px 16px", fontSize: 12.5 }}>
                {busy === "send" ? "Copying…" : "Copy and mark as sent"}
              </button>
            ) : (
              // Nothing is due, so there is no action to log. Inventing one would
              // put a touch on the record that the engine never asked for.
              <span style={{ color: T.DIM, fontSize: 11.5 }}>Nothing due — copy without logging.</span>
            )}
            <button onClick={() => void copyOnly()} disabled={busy !== null}
              style={{ ...btnSecondary, padding: "10px 16px", fontSize: 12.5 }}>
              {busy === "copy" ? "Copying…" : "Copy only"}
            </button>
          </div>
        </>
      )}

      {confirmation && (
        <div data-testid="confirmation" style={{ marginTop: 10, color: T.SUCCESS, fontSize: 12, fontWeight: 700 }}>
          {confirmation}
        </div>
      )}
      {error && <div style={{ marginTop: 10, color: T.ERROR, fontSize: 12 }}>{error}</div>}
    </div>
  )
}
