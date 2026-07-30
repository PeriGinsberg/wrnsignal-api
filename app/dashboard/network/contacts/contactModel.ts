// The contact model shared by every surface that shows one: the type, the due
// computation, and the urgency ranking the TODAY panel is capped by.
//
// Pure and component-free on purpose. This used to be ContactRow.tsx, which
// stopped being true when the spreadsheet row became a DueCard and a GridCard.

import type { MeaningKey } from "../../../../lib/theme/surfaces"

export type Contact = {
  id: string
  first_name: string
  last_name: string
  title: string | null
  email?: string | null   // not rendered in the row; searched by the spreadsheet
  stage: string
  relationship: string | null
  priority: string | null
  segment: string | null
  next_due_at: string | null
  next_due_reason: string | null
  last_action_at: string | null
  company_id: string | null
  network_companies?: { name: string } | null
  // Milestone stamps + outcome, used by the dashboard. Optional because the row
  // itself never reads them and older callers do not send them.
  first_touch_at?: string | null
  first_replied_at?: string | null
  first_chat_at?: string | null
  outcome_type?: string | null
}

const DAY = 86400000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// The single computed "Due" state. Words only, never a raw date, and it carries
// a MEANING key rather than a colour so it reads correctly on either surface.
export type Due = { label: string; meaning: MeaningKey; kind: "overdue" | "due_today" | "future" | "none" }
export function dueOf(nextDueAt: string | null): Due {
  if (!nextDueAt) return { label: "Nothing due", meaning: "idle", kind: "none" }
  const due = startOfDay(new Date(nextDueAt))
  const today = startOfDay(new Date())
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`
  if (due < today) return { label: `Overdue ${plural(Math.round((today - due) / DAY))}`, meaning: "error", kind: "overdue" }
  if (due === today) return { label: "Due today", meaning: "attention", kind: "due_today" }
  return { label: `Due in ${plural(Math.round((due - today) / DAY))}`, meaning: "idle", kind: "future" }
}

/** Due today or overdue. The one distinction the whole row design turns on. */
export function needsMe(due: Due): boolean {
  return due.kind === "overdue" || due.kind === "due_today"
}

/**
 * Hero ordering: overdue first (deepest first), then due today, then soonest.
 *
 * Computed ONCE at partition time and frozen with it. If this re-ranked live,
 * the cap would itself become a source of cards moving under someone mid-work,
 * which is the exact thing the frozen order exists to prevent.
 */
export function heroSort(contacts: Contact[]): Contact[] {
  const key = (c: Contact) => {
    const d = dueOf(c.next_due_at)
    const at = c.next_due_at ? new Date(c.next_due_at).getTime() : Number.MAX_SAFE_INTEGER
    if (d.kind === "overdue") return [0, at] as const      // earliest date = most overdue
    if (d.kind === "due_today") return [1, at] as const
    return [2, at] as const
  }
  return [...contacts].sort((a, b) => {
    const [ra, ta] = key(a), [rb, tb] = key(b)
    return ra !== rb ? ra - rb : ta - tb
  })
}

/** How many due contacts the TODAY panel shows. The rest fall to the grid. */
export const HERO_CAP = 5

export const initialsOf = (c: Contact) =>
  `${(c.first_name || "").charAt(0)}${(c.last_name || "").charAt(0)}`.toUpperCase() || "?"
