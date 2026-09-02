"use client"

// WHERE THINGS STAND — the last thing you did, when, and whether it is your move.
//
// REPLACES A NINE-CIRCLE STEPPER. That stepper drew the whole eleven-stage path
// with the current step lit, and it was the wrong answer to the question people
// arrive with. Nobody opens a contact asking "which of nine stages is this in";
// they ask "where did I leave this, and do I need to do something". The path
// answered the first question beautifully and the second not at all.
//
// It was also the third statement of one fact. The circles said "Message sent",
// "Next step: They replied" said it again as a stage name pretending to be an
// instruction, and the More stages dropdown said it a third time. Meanwhile the
// only thing that answered the real question, "Touch 2, Jul 25", sat at the
// bottom of the page inside a collapsed History drawer.
//
// So: one sentence of fact, one sentence of read, one button, and the stage
// demoted to a pill you can correct. The stage still matters and is still
// one click away; it is simply not the headline, because it never was.
//
// DRAFTS ARE NOT ACTIONS. `actions` now carries messages too, and an unsent
// draft has not happened. Counting one here would tell someone they wrote to a
// contact when they only thought about it.

import { useEffect, useMemo, useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../../../lib/theme/surfaces"
import { authFetch } from "../../authFetch"
import { STAGE_LABELS, REASON_LABELS, ACTION_TYPE_LABEL } from "../../vocab"
import { impliedStageAhead, historyImpliesAhead } from "../../../../../lib/network-tracker/action-semantics"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { isFlagDismissed, dismissFlag } from "../../../../../lib/network-tracker/reminderFlagDismissal"
import { ChangeStage } from "./ChangeStage"

type Contact = {
  id: string
  first_name: string
  stage: string
  next_due_at?: string | null
  next_due_reason?: string | null
  relationship?: string | null
  [k: string]: unknown
}

type Entry = {
  type: string
  action_date: string
  status?: string | null
  body?: string | null
}

// Past tense, and a sentence rather than a label. ACTION_TYPE_LABEL is built
// for a dropdown ("Touch 2"), which reads as a database value the moment you
// put it in prose. These are what a person would say happened.
const DID: Record<string, string> = {
  touch_1: "reached out",
  touch_2: "sent a second follow-up",
  touch_3: "sent a third follow-up",
  intro_request: "asked for an intro",
  thank_you: "sent a thank-you",
  connection_request: "sent a connection request",
  engage_on_post: "engaged with their post",
  chat_scheduled: "booked a chat",
  chat_done: "had the chat",
  ask: "made the ask",
  note_logged: "logged activity",
  note: "left a note",
  other: "logged something",
}

// The read on where that leaves you. One short sentence per stage, and none of
// them repeat the stage label: the pill beside them already says that.
const READ: Record<string, string> = {
  identified: "",
  intro_requested: "Waiting on the intro.",
  sequence_active: "No reply yet.",
  replied: "They wrote back. Your move.",
  chat_scheduled: "The chat is booked.",
  chat_done: "You have talked. Worth keeping warm.",
  nurture: "Ticking over. Nothing urgent.",
  ask_made: "The ask is with them.",
  outcome: "This one landed.",
  dormant_no_answer: "No answer in the end. Resting.",
  dormant_declined: "They passed. Resting.",
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 0
  const d = (now.getTime() - then.getTime()) / 86400000
  return Math.max(0, Math.round(d))
}

function ago(days: number): string {
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

export function WhereThingsStand({
  contact, onChanged, actions = [], onWrite, justLogged = null, onOfferSettled,
}: {
  contact: Contact
  onChanged: () => void
  /** The contact's history, already loaded by the record. Includes messages. */
  actions?: Entry[]
  /** Focuses the composer. The card offers the next move; the composer is where
   *  it happens, so this scrolls rather than opening a fourth way to act. */
  onWrite?: () => void
  /** The action just logged, if any. Drives the one-tap stage offer below. */
  justLogged?: string | null
  /** Called once that offer is taken or dismissed, so it does not re-appear. */
  onOfferSettled?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [viewerId, setViewerId] = useState("")
  const [flagHidden, setFlagHidden] = useState(false)
  const now = new Date()

  // The account, for scoping the dismissal. Wrapped because
  // getSupabaseBrowser() throws SYNCHRONOUSLY without its env vars, and a flag
  // must never take the record down; the same trap the strip fell into.
  useEffect(() => {
    let alive = true
    try {
      getSupabaseBrowser().auth.getSession().then(({ data }) => {
        const id = data.session?.user?.id ?? ""
        if (alive && id) setViewerId(id)
      }).catch(() => {})
    } catch {}
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!viewerId) { setFlagHidden(false); return }
    setFlagHidden(isFlagDismissed(viewerId, contact.id, contact.next_due_at))
  }, [viewerId, contact.id, contact.next_due_at])

  async function move(stage: string) {
    setBusy(stage); setErr(null)
    try {
      const res = await authFetch(`/api/network/contacts/${contact.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Update failed (${res.status})`)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // The last thing that actually HAPPENED. Drafts excluded for the same reason
  // the reminder engine excludes them: writing is not doing.
  const last = useMemo(() => {
    const done = (actions ?? []).filter((a) => a.status !== "draft" && a.action_date)
    return done.sort((a, b) => b.action_date.localeCompare(a.action_date))[0] ?? null
  }, [actions])

  const stage = contact.stage
  const read = READ[stage] ?? ""

  // Stage and history describing the same events without responding to each
  // other is what a tester reported as the two contradicting: logging "Chat
  // done" left the stage reading "Message sent". The stage stays something the
  // user ASSERTS, so these only notice the gap.
  const offered = justLogged ? impliedStageAhead(stage, justLogged) : null
  // Suppressed while an offer is up: it names the same move, and saying it
  // twice turns a quiet fact into nagging.
  const evidence = offered ? null : historyImpliesAhead(stage, (actions ?? []).filter((a) => a.status !== "draft") as never)

  // Line one. The whole point of the card: what you did, and how long ago.
  const headline = last
    ? `You ${DID[last.type] ?? "logged something"} ${ago(daysBetween(last.action_date, now))}.`
    : `You have not reached out to ${contact.first_name} yet.`

  // The button. next_due_reason is the engine's own answer to "what next", so
  // it is used rather than re-derived; REASON_LABELS already phrases each one
  // as an instruction. With nothing scheduled it falls back to the honest
  // generic, and with no history at all it names the first step explicitly,
  // which is the "do I need to start" case.
  const cta = !last
    ? "Write the first message"
    : contact.next_due_reason
      ? REASON_LABELS[contact.next_due_reason] ?? `Write to ${contact.first_name}`
      : `Write to ${contact.first_name}`

  const resting = stage === "dormant_no_answer" || stage === "dormant_declined"

  // THE FLAG. Raised only when the reminder is actually owed: today or past.
  // A reminder three weeks out is information, not a flag, and the reminder
  // line further down already states it. Flagging it would teach people that
  // the banner at the top means nothing in particular.
  const dueDays = contact.next_due_at ? daysBetween(contact.next_due_at, now) : null
  const dueAtMs = contact.next_due_at ? new Date(contact.next_due_at).getTime() : null
  const owed = dueAtMs !== null && dueAtMs <= now.getTime()
  const showFlag = owed && !flagHidden && !resting

  return (
    <section style={card} data-testid="where-things-stand">
      <div style={eyebrow}>Where things stand</div>

      {/* THE FOLLOW-UP FLAG, dated, at the top where it is the first thing read.
          It was a grey line below the composer saying "Follow-up reminder was 34
          days ago", which is the single most actionable fact on the page and was
          sitting under the fold in the quietest ink on the screen.

          DISMISSAL IS SCOPED TO THIS DUE DATE, not to the contact. Waving away
          "you were going to follow up on Aug 1" says nothing about the next
          reminder, so the next one asks again and old keys expire by
          themselves. It does not touch next_due_at: the engine owns that, and
          a dismissal that silently cleared a date the user chose would be the
          product overruling them. Snooze, below, is how you move the date. */}
      {showFlag && (
        <div style={flagBox} data-testid="reminder-flag">
          <span style={flagDot} aria-hidden="true" />
          <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13.5, color: S.meaning.attention.ink }}>
            <strong style={{ fontWeight: 800 }}>
              {dueDays === 0 ? "Follow up today" : `Follow-up was due ${ago(dueDays ?? 0)}`}
            </strong>
            {contact.next_due_at ? <> · {fmtDate(contact.next_due_at)}</> : null}
            {contact.next_due_reason ? <> · {REASON_LABELS[contact.next_due_reason] ?? ""}</> : null}
          </span>
          <button
            type="button"
            data-testid="reminder-flag-dismiss"
            onClick={() => {
              if (viewerId) dismissFlag(viewerId, contact.id, contact.next_due_at)
              setFlagHidden(true)
            }}
            style={flagDismiss}
            aria-label="Dismiss this reminder flag"
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={headlineStyle} data-testid="wts-headline">{headline}</div>
      {read && <div style={readStyle} data-testid="wts-read">{read}</div>}

      {/* THE OFFER, one tap and dismissible. It appears where the stage is
          STATED rather than beside the log, because the confusion it fixes was
          that the two systems looked unrelated. */}
      {offered && (
        <div style={offerBox} data-testid="stage-offer">
          <span style={{ fontSize: 13.5, color: S.text.primary, flex: "1 1 220px", minWidth: 0 }}>
            You logged {ACTION_TYPE_LABEL[justLogged ?? ""] ?? "an action"}. Move this to{" "}
            <strong style={{ fontWeight: 800 }}>{STAGE_LABELS[offered]}</strong>?
          </span>
          <button
            type="button"
            data-testid="stage-offer-accept"
            disabled={busy !== null}
            onClick={() => { void move(offered); onOfferSettled?.() }}
            style={{ ...actionStyle(S, "primary"), borderRadius: 9, padding: "7px 14px", fontSize: 13, fontFamily: "inherit", cursor: busy ? "default" : "pointer" }}
          >
            Move it
          </button>
          <button
            type="button"
            data-testid="stage-offer-dismiss"
            onClick={() => onOfferSettled?.()}
            style={{ background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: S.text.muted, cursor: "pointer" }}
          >
            Not yet
          </button>
        </div>
      )}

      {/* EVIDENCE, NOT A CORRECTION. Being behind your own log is a legitimate
          position: the chat went nowhere, you are parking them, you disagree
          that it counted. This reports and does not judge, and asks nothing, so
          there is no dismissal to remember. */}
      {evidence && (
        <p style={evidenceStyle} data-testid="log-evidence">
          Your log shows{" "}
          <strong style={{ color: S.text.secondary, fontWeight: 700 }}>
            {ACTION_TYPE_LABEL[evidence.type] ?? evidence.type}
          </strong>{" "}
          on {fmtDate(evidence.action_date)}.
        </p>
      )}

      {/* THE ONE AUTOMATIC CASE, said before it happens. Stage is normally
          something the user asserts, and a first outreach is the exception:
          `identified` has no due reason, so a contact left there after being
          written to has no due date at all, parked silently. That rule used to
          live only in a comment in action-semantics.ts, where the person it
          affects cannot read it. */}
      {stage === "identified" && (
        <p style={evidenceStyle} data-testid="auto-advance-note">
          Your first message moves this to{" "}
          <strong style={{ color: S.text.secondary, fontWeight: 700 }}>
            {STAGE_LABELS.sequence_active}
          </strong>{" "}
          on its own, so it starts getting reminders.
        </p>
      )}

      {err && <p style={{ ...evidenceStyle, color: S.meaning.error.ink, fontWeight: 700 }}>{err}</p>}

      <div style={footer}>
        {/* Not offered on a resting contact. Suggesting a follow-up to someone
            who said no is the product arguing with the user's own decision;
            the stage pill still lets them reopen it deliberately. */}
        {!resting && (
          <button type="button" onClick={onWrite} style={cta_btn} data-testid="wts-write">
            {cta}
          </button>
        )}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={pill} data-testid="stage-pill">{STAGE_LABELS[stage] ?? stage}</span>
          <ChangeStage contact={contact as never} onChanged={onChanged} />
        </span>
      </div>
    </section>
  )
}

const card: React.CSSProperties = {
  marginTop: 16, borderRadius: 16, padding: "20px 24px",
  background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card,
}
const eyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
  color: S.text.muted, marginBottom: 12,
}
// The fact, at reading size. It is the reason the card exists, so it is the
// biggest thing in it.
const headlineStyle: React.CSSProperties = {
  fontSize: 19, fontWeight: 700, color: S.text.primary, lineHeight: "26px",
}
const readStyle: React.CSSProperties = {
  fontSize: 15, color: S.text.secondary, marginTop: 4, lineHeight: "22px",
}
const footer: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap",
}
// Navy, not peach. Peach is the composer's Send; this only scrolls to it, and
// two peach buttons on one screen would each dilute the other.
const cta_btn: React.CSSProperties = {
  background: S.action.fill, color: S.action.ink, border: "none",
  borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 800,
  fontFamily: "inherit", cursor: "pointer",
}
const pill: React.CSSProperties = {
  background: S.well, border: `1px solid ${S.border}`, borderRadius: 999,
  padding: "5px 12px", fontSize: 13, fontWeight: 700, color: S.text.primary,
  whiteSpace: "nowrap",
}

const offerBox: React.CSSProperties = {
  marginTop: 14, padding: "12px 14px", borderRadius: 10,
  background: S.meaning.current.fill,
  border: `1px solid ${S.meaning.current.accent}`,
  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
}
const evidenceStyle: React.CSSProperties = {
  margin: "12px 0 0", color: S.text.muted, fontSize: 13, lineHeight: "19px",
}

// Attention, not error: a follow-up you have not sent is something that needs
// you, and nothing has gone wrong.
const flagBox: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  background: S.meaning.attention.fill,
  border: `1px solid ${S.meaning.attention.accent}`,
  borderRadius: 10, padding: "10px 13px", marginBottom: 14,
}
const flagDot: React.CSSProperties = {
  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
  background: S.meaning.attention.accent,
}
const flagDismiss: React.CSSProperties = {
  background: "none", border: "none", padding: 0, fontFamily: "inherit",
  fontSize: 12.5, fontWeight: 700, color: S.meaning.attention.ink,
  opacity: 0.75, cursor: "pointer", flexShrink: 0,
}
