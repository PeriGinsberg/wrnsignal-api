// Dashboard metrics — pure functions over the contacts list.
//
// Computed CLIENT-SIDE from the list the dashboard already fetches, not from an
// aggregate route. At a realistic board size (hundreds of contacts) this is a
// few passes over an array the page has in memory anyway; extract a route later
// if it ever gets slow, not before.
//
// Every number here is an ALL-TIME snapshot except weeklyFirstTouches. No trends,
// no date picker — history means a daily aggregates table and a job to fill it,
// which is a phase of its own.
//
// The "or beyond" semantics come free from the milestone stamps: first_touch_at /
// first_replied_at / first_chat_at are written once and never recomputed, so a
// contact now at `nurture` still counts as having replied. Deriving these from
// the CURRENT stage instead would make the reply rate fall as things went well.

import { STAGE_PHASE, PHASE_ORDER, PHASE_LABELS, RELATIONSHIP_LABEL } from "./vocab"
import type { PhaseKey } from "../../../lib/dashboard-theme"
import type { Contact } from "./contacts/ContactRow"

// A split with fewer than this many reached is noise. Show the count and say so
// rather than printing a rate over four contacts that will swing 25% on the next
// reply.
export const MIN_SPLIT_N = 5

// The benchmark line is gated on reached, not on "finished all three touches" as
// originally specced — per-contact touch counts live in network_actions, which
// the dashboard deliberately does not fetch. Reached is the honest proxy, and the
// wording says so.
export const BENCHMARK_MIN_REACHED = 10

export const STALLED_DAYS = 14
export const RESURFACING_DAYS = 7
export const WEEKLY_TARGET_MIN = 5
export const WEEKLY_TARGET_MAX = 8

const DAY = 86400000

const reached = (c: Contact) => Boolean(c.first_touch_at)
const replied = (c: Contact) => Boolean(c.first_replied_at)
const chatted = (c: Contact) => Boolean(c.first_chat_at)

/** Monday 00:00 of the week containing `now`, local time. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dow = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow)
  return d
}

/**
 * Stalled: sitting in the outreach sequence with nothing logged for 14+ days.
 * Exported so the dashboard row and the Contacts `?status=stalled` deep-link
 * share ONE definition — if they drifted, clicking the row would show a
 * different set of people than the row counted.
 */
export function isStalled(c: Contact, now: Date): boolean {
  if (c.stage !== "sequence_active") return false
  if (!c.last_action_at) return false
  return now.getTime() - new Date(c.last_action_at).getTime() >= STALLED_DAYS * DAY
}

export type FunnelGroup = { phase: PhaseKey; label: string; count: number }

/** One entry per phase group, in canonical order — including empty ones, so the
 *  shape of the funnel is stable and a zero reads as "nobody here yet". */
export function funnel(contacts: Contact[]): FunnelGroup[] {
  const counts = new Map<PhaseKey, number>(PHASE_ORDER.map((p) => [p, 0]))
  for (const c of contacts) {
    const p = STAGE_PHASE[c.stage] ?? "idle"
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return PHASE_ORDER.map((p) => ({ phase: p, label: PHASE_LABELS[p], count: counts.get(p) ?? 0 }))
}

export type Conversion = {
  total: number
  reached: number
  replied: number
  chatted: number
  replyRate: number | null   // null when the denominator is 0
  chatRate: number | null
  outcomes: { key: string; count: number }[]
  outcomeTotal: number
  showBenchmark: boolean
}

export function conversion(contacts: Contact[]): Conversion {
  const r = contacts.filter(reached).length
  const rep = contacts.filter(replied).length
  const ch = contacts.filter(chatted).length

  const byOutcome = new Map<string, number>()
  for (const c of contacts) {
    if (c.stage !== "outcome") continue
    const k = c.outcome_type || "unspecified"
    byOutcome.set(k, (byOutcome.get(k) ?? 0) + 1)
  }

  return {
    total: contacts.length,
    reached: r,
    replied: rep,
    chatted: ch,
    // Rates are null rather than 0 when there is no denominator — "0%" and
    // "nobody reached yet" are different statements.
    replyRate: r > 0 ? rep / r : null,
    chatRate: rep > 0 ? ch / rep : null,
    outcomes: [...byOutcome].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    outcomeTotal: [...byOutcome.values()].reduce((s, n) => s + n, 0),
    showBenchmark: r >= BENCHMARK_MIN_REACHED,
  }
}

export type SplitRow = {
  key: string
  label: string
  reached: number
  replied: number
  rate: number | null    // null when suppressed
  suppressed: boolean    // reached < MIN_SPLIT_N
}

/**
 * Reply rate broken down by a contact field. Rows are ordered by reached
 * descending so the categories carrying the most work sort to the top, and
 * under-threshold rows are kept (not dropped) — "we tried 3 recruiters and
 * cannot tell yet" is information; silently omitting the row is not.
 */
export function splitBy(contacts: Contact[], field: "relationship" | "segment"): SplitRow[] {
  const groups = new Map<string, Contact[]>()
  for (const c of contacts) {
    const raw = (c[field] ?? "").trim()
    if (!raw) continue // unset is its own needs-attention row, not a split bucket
    const g = groups.get(raw) ?? []
    g.push(c)
    groups.set(raw, g)
  }
  return [...groups]
    .map(([key, list]) => {
      const r = list.filter(reached).length
      const rep = list.filter(replied).length
      const suppressed = r < MIN_SPLIT_N
      return {
        key,
        label: field === "relationship" ? (RELATIONSHIP_LABEL[key] ?? key) : key,
        reached: r,
        replied: rep,
        rate: suppressed || r === 0 ? null : rep / r,
        suppressed,
      }
    })
    .sort((a, b) => b.reached - a.reached || a.label.localeCompare(b.label))
}

/** New first touches since Monday — the effort metric. Measures what the client
 *  controls, unlike replies. Follow-ups completed this week are NOT counted:
 *  touch_2/touch_3 live in network_actions, which the dashboard does not fetch
 *  (deferred, see DASHBOARD.md). */
export function weeklyFirstTouches(contacts: Contact[], now: Date): number {
  const monday = startOfWeek(now).getTime()
  return contacts.filter((c) => c.first_touch_at && new Date(c.first_touch_at).getTime() >= monday).length
}

export type NeedsAttention = {
  stalled: Contact[]
  priorityAIdentified: Contact[]
  resurfacing: Contact[]
  noRelationship: Contact[]
}

export function needsAttention(contacts: Contact[], now: Date): NeedsAttention {
  const horizon = now.getTime() + RESURFACING_DAYS * DAY
  return {
    stalled: contacts.filter((c) => isStalled(c, now)),
    priorityAIdentified: contacts.filter((c) => c.priority === "A" && c.stage === "identified"),
    resurfacing: contacts.filter(
      (c) =>
        (STAGE_PHASE[c.stage] ?? "idle") === "resting" &&
        c.next_due_at != null &&
        new Date(c.next_due_at).getTime() <= horizon,
    ),
    noRelationship: contacts.filter((c) => !c.relationship),
  }
}

export function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`
}
