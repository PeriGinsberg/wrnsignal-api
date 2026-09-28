"use client"

// History: a read-only, newest-first timeline of the relationship's business
// events (coach_client_events). Shared by the linked-client page (tab) and the
// prospect detail page (section); both pass coach_clients.id directly. Read API:
//   GET /api/coach/coach-clients/[ccId]/events
//   → [{ event_type, actor_profile_id, context, created_at }] newest-first.
//
// Quiet and scannable: a record to read, not a dashboard. Read-only: no actions.
// Log-forward, so older relationships legitimately start empty (not an error).
//
// getToken/authFetch inlined per the coach-route client convention (same pair as
// EngagementsTab / NotesTab).

import { useCallback, useEffect, useState } from "react"
import { SPACE, TYPE } from "../../../../../lib/theme/surfaces"
import { T, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import type { CoachClientEventType } from "../../../../../lib/coach/clientEventTypes"

export type CoachClientEvent = {
  event_type: string
  actor_profile_id: string | null
  actor_name: string | null
  actor_is_system: boolean
  context: Record<string, any> | null
  created_at: string
}

/**
 * Who or what did it.
 *
 * A null actor means nothing chose this: a rule fired, a job ran, a webhook
 * landed. That is SIGNAL, and the timeline says so by name rather than
 * "System", because a coach reading their own history should see the product
 * they use and not a category of software.
 *
 * Never null. An event with an actor we cannot name still has to say who: an
 * unattributed line in an audit trail is the one thing it must not have.
 */
export function actorLabel(e: CoachClientEvent): string {
  if (e.actor_is_system) return "SIGNAL"
  return e.actor_name || "SIGNAL"
}

// event_type (+ context) → a readable line. Falls back to the raw type for any
// future event the UI doesn't have copy for yet.
/**
 * EVERY event type needs wording. The map is exhaustive over the union, so
 * adding a type to COACH_CLIENT_EVENT_TYPES without a line here fails the
 * typecheck rather than shipping: `account_created` reached production with no
 * case and rendered to coaches as the literal string "account_created".
 */
export const LABELS: Record<CoachClientEventType, (e: CoachClientEvent) => string> = {
  prospect_created: () => "Prospect created",
  stage_changed: (e) =>
    e.context?.stage_key ? `Moved to stage: ${e.context.stage_key}` : "Moved to a new stage",
  converted_to_client: () => "Converted to client",
  proposal_sent: () => "Proposal sent",
  proposal_approved: () => "Proposal approved",
  proposal_declined: () => "Proposal declined",
  engagement_attached: () => "Engagement attached",
  engagement_detached: () => "Engagement detached",
  // The actor's name now says who completed it, so the line no longer has to.
  activity_completed: () => "Activity completed",
  invite_sent: () => "SIGNAL invite sent",
  invite_accepted: () => "Invite accepted",
  account_created: () => "Account created",
  workbook_created: () => "Workbook created",
  workbook_shared: () => "Workbook shared",
  workbook_sent_for_review: (e) => {
    const n = Number(e.context?.open_questions ?? 0)
    return n > 0 ? `Workbook sent for review, ${n} question${n === 1 ? "" : "s"}` : "Workbook sent for review"
  },
  workbook_returned: () => "Workbook returned with comments",
  homework_complete: (e) =>
    e.context?.session ? `Session ${e.context.session} homework marked complete` : "Homework marked complete",
  homework_webhook_failed: () => "Homework notification to GoHighLevel failed",

  practice_round_sent: (e) => {
    const n = Number(e.context?.questions ?? 0)
    return n > 0 ? `Practice round sent, ${n} question${n === 1 ? "" : "s"}` : "Practice round sent"
  },
  practice_feedback_sent: (e) => {
    const n = Number(e.context?.questions ?? 0)
    return n > 0 ? `Practice feedback sent on ${n} answer${n === 1 ? "" : "s"}` : "Practice feedback sent"
  },
  practice_round_submitted: (e) => {
    const n = Number(e.context?.questions ?? 0)
    return n > 0 ? `Practice round recorded, ${n} answer${n === 1 ? "" : "s"}` : "Practice round recorded"
  },

  campaign_brief_submitted: (e) =>
    e.context?.name ? `Campaign brief submitted: ${e.context.name}` : "Campaign brief submitted",
  // The title is the task. Without it the line says an unnamed something
  // happened, which is the shape of an audit trail nobody reads.
  task_created: (e) => `Task created: ${e.context?.title ?? "untitled"}`,
  task_completed: (e) => {
    const t = `Task completed: ${e.context?.title ?? "untitled"}`
    if (e.context?.decision === "approve") return `${t} (approved)`
    if (e.context?.decision === "request_changes") return `${t} (changes requested)`
    return t
  },
  // THE NOTE IS THE POINT of a reopen. Request Changes sends work back, and
  // the reason is what the next person needs; a timeline saying only that it
  // came back makes them go and ask.
  task_reopened: (e) => {
    const t = `Task reopened: ${e.context?.title ?? "untitled"}`
    return e.context?.note ? `${t}: ${e.context.note}` : t
  },
  task_reassigned: (e) =>
    e.context?.to_name
      ? `Task reassigned to ${e.context.to_name}: ${e.context?.title ?? "untitled"}`
      : `Task reassigned: ${e.context?.title ?? "untitled"}`,
  networking_plan_generated: () => "Networking plan generated",
  networking_plan_shared: () => "Networking plan shared with client",
  client_email_sent: (e) =>
    e.context?.to ? `Email sent to ${e.context.to}: ${e.context?.subject ?? "networking plan"}`
      : `Email sent: ${e.context?.subject ?? "networking plan"}`,
}

export function describe(e: CoachClientEvent): string {
  const name = typeof e.context?.name === "string" ? e.context.name
    : typeof e.context?.title === "string" ? e.context.title
    : null
  const label = LABELS[e.event_type as CoachClientEventType]
  // An event type the server knows and this build does not: show the raw type
  // rather than nothing, so it is visibly wrong instead of silently missing.
  const text = label ? label(e) : e.event_type
  // The suffix exists to name the subject of an event whose label is generic
  // ("Workbook created · Session 1"). The task lines name it themselves,
  // because a reopen has to read "Task reopened: Build - the reason" rather
  // than pushing the title past the reason. Appending anyway printed the title
  // twice, so a label that already said it wins.
  return name && !text.includes(name) ? `${text} · ${name}` : text
}

// THE DATE AND THE TIME ARE SHOWN, not hidden in a tooltip.
//
// This used to render "3 days ago" with the real datetime on hover. Relative
// time reads well on a feed and badly on a record: "was the email before or
// after the share" is the question an audit trail is opened to answer, and two
// lines both saying "3 days ago" cannot answer it. A tooltip cannot be read on
// a phone at all.
function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return "just now"
  // Walk up the units, dividing as we cross each threshold.
  let val = Math.floor(sec / 60)
  let label = "minute"
  const steps: [number, string][] = [[60, "hour"], [24, "day"], [30, "month"], [12, "year"]]
  for (const [factor, next] of steps) {
    if (val < factor) break
    val = Math.floor(val / factor)
    label = next
  }
  return `${val} ${label}${val === 1 ? "" : "s"} ago`
}
function exactTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

/** "25 Sep 2026, 11:59 AM" in the reader's own timezone. */
export function stamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  })
}

// ── Auth (same inline pattern as EngagementsTab) ──
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}

export function HistoryTab({ coachClientId }: { coachClientId: string | null }) {
  const [events, setEvents] = useState<CoachClientEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!coachClientId) { setLoading(false); setEvents([]); return } // benign empty
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(`/api/coach/coach-clients/${coachClientId}/events`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load history (${res.status})`)
        return
      }
      setEvents(j.events || [])
    } catch {
      setLoadError("Network error. Try again.")
    } finally {
      setLoading(false)
    }
  }, [coachClientId])

  useEffect(() => { void load() }, [load])

  if (!coachClientId) {
    return <p style={{ fontSize: TYPE.secondary, color: T.DIM, margin: 0 }}>No activity logged yet.</p>
  }
  if (loading) {
    return <p style={{ fontSize: TYPE.secondary, color: T.MUTED, margin: 0 }}>Loading history…</p>
  }
  if (loadError) {
    return (
      <div>
        <div style={{ fontSize: TYPE.secondary, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
          {loadError}
        </div>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }
  if (events.length === 0) {
    return <p style={{ fontSize: TYPE.secondary, color: T.DIM, margin: 0 }}>No activity logged yet.</p>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e, i) => (
        <div
          key={`${e.created_at}-${i}`}
          style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "9px 0",
            borderTop: i === 0 ? "none" : `1px solid ${T.BORDER_SOFT}`,
          }}
        >
          {/* Quiet timeline marker */}
          <span aria-hidden style={{ marginTop: 6, width: 6, height: 6, borderRadius: 999, background: T.DIM, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: TYPE.secondary, color: T.TEXT }}>{describe(e)}</div>
            <div style={{ fontSize: TYPE.micro, color: T.DIM, marginTop: 2 }} title={`${exactTime(e.created_at)} · ${relTime(e.created_at)}`}>
              {stamp(e.created_at)} · {actorLabel(e)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
