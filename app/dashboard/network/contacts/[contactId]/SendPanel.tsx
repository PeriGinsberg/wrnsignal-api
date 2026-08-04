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

// Redesign step 4: this panel now sits inside a NAVY hero, so its own text reads
// on hero ink rather than on a card. The message box is the one white surface
// inside it, which is what makes the draft look like a thing you pick up and
// paste. Logic is untouched: same pickTemplate, same copy-first-then-log
// ordering, same ephemeral draft.

import { useCallback, useEffect, useMemo, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { displayName } from "../../templates/templateNames"
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
  // Normally the due reason names the action, which is how this panel and the
  // inline Log button (ContactRow) stay in agreement about what a touch is.
  //
  // ONE exception, and it is the point of the redesign: a contact at
  // `identified` has NO due reason — the engine schedules nothing there — so on
  // the old derivation the primary button never appeared and the first message
  // could not be sent from the screen built for sending. Treat first outreach as
  // the due action at that stage. The server applies the matching stage move
  // (stageAfterAction), so the two cannot disagree about what just happened.
  const actionType = reason
    ? (REASON_TO_ACTION[reason] ?? "note_logged")
    : contact.stage === "identified" ? "touch_1" : null

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

  if (loading) return <div style={{ color: S.hero.muted, fontSize: 13 }}>Loading templates…</div>

  const gaps = rendered ? [...gapsNow.unresolved, ...gapsNow.toFill] : []

  return (
    <div data-testid="send-panel">
      {!suggestedId && !chosenId && (
        // Not an error state. S1/S5 have no due reason that implies them, and a
        // first message needs a relationship to choose a family.
        <p style={{ color: S.hero.muted, fontSize: 13.5, margin: "0 0 12px", lineHeight: "20px" }}>
          {contact.relationship
            ? "No suggested template for this moment — pick one below."
            : "Set a relationship to get a suggested template, or pick one below."}
        </p>
      )}

      {rendered && (
        <textarea
          data-testid="rendered-message"
          aria-label="Message"
          value={messageText}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck
          rows={Math.min(24, Math.max(4, messageText.split("\n").length + 1))}
          style={{
            display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
            whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 15.5, lineHeight: "25px",
            color: S.text.primary, background: S.card,
            border: `2px solid ${isEdited ? S.meaning.progress.accent : "transparent"}`,
            borderRadius: 12, padding: "16px 18px", margin: "0 0 10px",
            outline: "none",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14, minHeight: 20 }}>
        <span style={{ color: S.hero.muted, fontSize: 13 }}>
          {isEdited ? (
            <span data-testid="edited-note">
              Edited for {contact.first_name}, this copy only, not saved to the template.
            </span>
          ) : (
            "Tap the message to edit before you send."
          )}
        </span>
        {isEdited && (
          <button
            onClick={() => setDraft(null)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: S.hero.link, fontSize: 13, fontWeight: 700, textDecoration: "underline",
              fontFamily: "inherit",
            }}
          >
            Revert to suggestion
          </button>
        )}
      </div>

      {rendered && (
        <>
          {gaps.length > 0 && (
            // Warn, never block. Someone may well finish the sentence in Gmail,
            // and refusing to copy would just push them to retype it by hand.
            <div
              data-testid="gap-warning"
              style={{
                // Attention as TEXT, not as a fill. The peach fill is reserved
                // for the button below, so the warning takes the peach accent as
                // ink on a left rail and reads as a caution rather than as a
                // second thing to click. At 12% alpha this was a plain dark box
                // and lost the signal entirely.
                background: "rgba(254,176,106,0.10)",
                borderLeft: `3px solid ${S.meaning.attention.accent}`,
                borderRadius: "0 10px 10px 0", padding: "12px 16px", marginBottom: 14,
                color: S.meaning.attention.accent, fontSize: 13.5, lineHeight: "20px",
                fontWeight: 600,
              }}
            >
              {gapsNow.unresolved.length > 0 && (
                <div>
                  Still unfilled: {gapsNow.unresolved.map((v) => `[${v}]`).join(", ")}. Fill your
                  networking profile, or edit before sending.
                </div>
              )}
              {gapsNow.toFill.length > 0 && (
                <div style={{ marginTop: gapsNow.unresolved.length ? 5 : 0 }}>
                  Fill in {gapsNow.toFill.map((v) => `[${v}]`).join(", ")} before sending. These
                  are yours to write.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {actionType ? (
              <button
                onClick={() => void copyAndSend()}
                disabled={busy !== null}
                style={{ ...actionStyle(S, "primary"), ...btnSize, opacity: busy !== null ? 0.6 : 1 }}
              >
                {busy === "send" ? "Copying…" : "Copy and mark as sent"}
              </button>
            ) : (
              // Nothing is due, so there is no action to log. Inventing one would
              // put a touch on the record that the engine never asked for.
              <span style={{ color: S.hero.muted, fontSize: 13 }}>Nothing due — copy without logging.</span>
            )}
            <button
              onClick={() => void copyOnly()}
              disabled={busy !== null}
              style={{
                ...btnSize,
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.16)",
                color: S.hero.ink,
                cursor: "pointer",
                opacity: busy !== null ? 0.6 : 1,
              }}
            >
              {busy === "copy" ? "Copying…" : "Copy only"}
            </button>
          </div>
        </>
      )}

      {/* Template chrome sits BELOW the action, deliberately. Which template is
          in the box is reference; sending the message is the job. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: S.hero.muted, fontSize: 12.5, fontWeight: 700 }}>Template</span>
          <select
            value={activeId ?? ""}
            onChange={(e) => setChosenId(e.target.value || null)}
            aria-label="Template"
            style={{
              background: "rgba(255,255,255,0.10)", color: S.hero.ink,
              border: "1px solid rgba(255,255,255,0.16)", borderRadius: 9,
              height: 34, fontSize: 13, padding: "0 10px", maxWidth: 300,
              fontFamily: "inherit", cursor: "pointer",
            }}
          >
            <option value="" style={darkOption}>Choose a template…</option>
            {templates.map((t) => (
              <option key={t.template_id} value={t.template_id} style={darkOption}>
                {displayName(t.template_id)}{t.source === "override" ? " (edited)" : ""}
              </option>
            ))}
          </select>
        </label>
        {active && (
          <span style={{ color: S.hero.muted, fontSize: 12.5 }} data-testid="active-template">
            {displayName(active.template_id)}
          </span>
        )}
        {active && (
          // The bridge to the permanent editor. Deliberately a LINK away rather
          // than an editor here: wanting to change this wording everywhere is a
          // different intent from tweaking this one message, and those two must
          // not share a surface.
          <a
            href={`/dashboard/network/templates?id=${active.template_id}`}
            data-testid="edit-template-link"
            style={{ color: S.hero.link, fontSize: 12.5, fontWeight: 700, textDecoration: "underline" }}
          >
            Edit this template
          </a>
        )}
      </div>

      {confirmation && (
        <div
          data-testid="confirmation"
          style={{ marginTop: 12, color: S.hero.ink, fontSize: 13.5, fontWeight: 700 }}
        >
          {confirmation}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, color: "#FFB4B0", fontSize: 13.5, lineHeight: "20px" }}>{error}</div>
      )}
    </div>
  )
}

const btnSize: React.CSSProperties = {
  padding: "12px 20px", fontSize: 14.5, borderRadius: 10, fontFamily: "inherit", fontWeight: 800,
}
// A native option list cannot be reliably tinted, so keep it explicitly dark to
// match the hero it drops out of rather than flashing white.
const darkOption: React.CSSProperties = { background: "#13294A", color: "#FFFFFF" }
