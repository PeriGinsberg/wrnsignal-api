// app/api/_lib/coachEngagements.ts
//
// Shared building blocks for the Client Engagement API — a sub-resource of
// coach_clients (coach_client_engagements + …_deliverables + …_activities).
// Auth / scoping is REUSED from ./coachAuth (the same generic coach-route
// helpers — bearer → authed user → coach profile → is_coach); not reinvented.
//
// SECURITY: the engagement tables have NO coach_profile_id and NO RLS —
// ownership reaches through coach_client_id → coach_clients.coach_profile_id.
// Every route first verifies the coach_clients row [id] belongs to the authed
// coach (isCoachClientOwnedByCoach); the [engagement_id] routes additionally
// match the engagement's coach_client_id to [id], so a coach can't read/delete
// another coach's engagement by pairing it with a coach_clients row they own.
//
// Pricing runs over the FROZEN snapshot deliverables (their copied fee_cents +
// the engagement's copied discount_cents) — identical math to toApiPackage, so
// editing the live catalog never moves an engagement's price. Cents never leak.

import { type SupabaseClient } from "@supabase/supabase-js"
// The unlock rule lives in one place and the coach side reads the SAME
// implementation the client page does. A second copy here is how the coach's
// warning and the client's card end up disagreeing about what is unlocked.
import { byOrder, wouldRelock, type ProofActivity } from "../../../lib/proofProject"

// Reuse the generic coach-route auth/scoping helpers (the recent worked example).
export { getSupabaseAdmin, resolveCoach, errStatus, UUID_RE } from "./coachAuth"

// ── Ownership guard: does this coach_clients row belong to the coach? ──
export async function isCoachClientOwnedByCoach(
  supabase: SupabaseClient,
  coachProfileId: string,
  coachClientId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("coach_clients")
    .select("id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (error) throw new Error(`Ownership check failed: ${error.message}`)
  return !!data
}

// ── Proposal lifecycle (on the engagement row): draft → sent → approved →
//    declined. Validated at the API edge with a clean 400 (the DB CHECK
//    coach_client_engagements_proposal_status_valid is only the backstop).
//    Note: this is independent of coach_clients lifecycle — approving has NO
//    side effect on the prospect/client row. ──
export const PROPOSAL_STATUSES = ["draft", "sent", "approved", "declined"] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]
export function isValidProposalStatus(v: unknown): v is ProposalStatus {
  return typeof v === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(v)
}

// ── Activity completion status (on a snapshot activity): not_started →
//    in_progress → complete. Validated at the edge with a clean 400 (the DB
//    CHECK ccea_status_valid is only the backstop). Per-snapshot-activity — the
//    catalog templates have no status. ──
export const ACTIVITY_STATUSES = ["not_started", "in_progress", "complete"] as const
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]
export function isValidActivityStatus(v: unknown): v is ActivityStatus {
  return typeof v === "string" && (ACTIVITY_STATUSES as readonly string[]).includes(v)
}

// ── Activity due date (on a snapshot activity): an optional calendar date.
//    Accepts null (clear) or a strict YYYY-MM-DD string that is a REAL date
//    (rejects 2026-13-40 etc.) so the DATE column never sees garbage. Validated
//    at the edge with a clean 400. ──
export function isValidActivityDueDate(v: unknown): v is string | null {
  if (v === null) return true
  if (typeof v !== "string") return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, da))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === da
}

// ── Activity owner (on a snapshot activity) ──
export const ACTIVITY_OWNERS = ["coach", "client", "both"] as const
export type ActivityOwner = (typeof ACTIVITY_OWNERS)[number]
export function isValidActivityOwner(v: unknown): v is ActivityOwner {
  return typeof v === "string" && (ACTIVITY_OWNERS as readonly string[]).includes(v)
}

/**
 * Activity / deliverable free text. Trimmed, non-empty, bounded.
 *
 * The 200 cap is not arbitrary: an activity name renders on one line in the
 * coach's list, in the client's plan tree and on the Proof Project journey. A
 * pasted paragraph would not be rejected by the DB (TEXT is unbounded) and would
 * silently wreck three layouts, so the edge is where it gets caught.
 */
export const ACTIVITY_NAME_MAX = 200
export function normalizeActivityName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t || t.length > ACTIVITY_NAME_MAX) return null
  return t
}

/**
 * Coach prose fields (speaking_point, why_this_matters). Nullable by design —
 * clearing one is a normal edit, so "" and whitespace normalize to null rather
 * than to an empty string that the client would render as a blank card.
 */
export const COACH_PROSE_MAX = 600
export function normalizeCoachProse(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  if (typeof v !== "string") return { ok: false }
  const t = v.trim()
  if (t.length > COACH_PROSE_MAX) return { ok: false }
  return { ok: true, value: t || null }
}

// ── Shared 3-level ownership walk for activity sub-resources (notes, …):
//    (1) the coach owns coach_clients [id]; (2) the engagement belongs to [id];
//    (3) the activity belongs to a deliverable of that engagement. Returns the
//    activity id + the relationship's client_profile_id (denormalized onto child
//    rows on insert), or null if ANY level fails — callers map null → 404. Mirrors
//    the walk in the activity status/due-date PATCH route; the [noteId] routes layer
//    a 4th check (note.engagement_activity_id === [activity_id]) on top. ──
export async function resolveOwnedEngagementActivity(
  supabase: SupabaseClient,
  coachProfileId: string,
  coachClientId: string,
  engagementId: string,
  activityId: string,
): Promise<{ activityId: string; clientProfileId: string | null } | null> {
  // (1) coach owns the relationship — and grab client_profile_id for denorm.
  const { data: rel, error: relErr } = await supabase
    .from("coach_clients")
    .select("id, client_profile_id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (relErr) throw new Error(`Ownership check failed: ${relErr.message}`)
  if (!rel) return null

  // (2) the engagement belongs to this relationship.
  const { data: eng, error: engErr } = await supabase
    .from("coach_client_engagements")
    .select("id")
    .eq("id", engagementId)
    .eq("coach_client_id", coachClientId)
    .maybeSingle()
  if (engErr) throw new Error(`Engagement lookup failed: ${engErr.message}`)
  if (!eng) return null

  // (3) the activity belongs to a deliverable of THIS engagement.
  const { data: act, error: actErr } = await supabase
    .from("coach_client_engagement_activities")
    .select("id, engagement_deliverable_id")
    .eq("id", activityId)
    .maybeSingle()
  if (actErr) throw new Error(`Activity lookup failed: ${actErr.message}`)
  if (!act) return null
  const { data: deliv, error: delErr } = await supabase
    .from("coach_client_engagement_deliverables")
    .select("engagement_id")
    .eq("id", act.engagement_deliverable_id)
    .maybeSingle()
  if (delErr) throw new Error(`Deliverable lookup failed: ${delErr.message}`)
  if (!deliv || deliv.engagement_id !== engagementId) return null

  return { activityId: act.id as string, clientProfileId: (rel.client_profile_id as string | null) ?? null }
}

/**
 * The same walk, but stopping at a DELIVERABLE rather than an activity — the
 * guard for "add an activity to this deliverable" and "edit this deliverable's
 * prose", where no activity id exists yet to walk through.
 *
 * Level (3) is the one that matters: without it a coach could pass another
 * coach's deliverable_id under their own [id]/[engagement_id] and write to it.
 */
export async function resolveOwnedEngagementDeliverable(
  supabase: SupabaseClient,
  coachProfileId: string,
  coachClientId: string,
  engagementId: string,
  deliverableId: string,
): Promise<{ deliverableId: string } | null> {
  const { data: rel, error: relErr } = await supabase
    .from("coach_clients")
    .select("id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (relErr) throw new Error(`Ownership check failed: ${relErr.message}`)
  if (!rel) return null

  const { data: eng, error: engErr } = await supabase
    .from("coach_client_engagements")
    .select("id")
    .eq("id", engagementId)
    .eq("coach_client_id", coachClientId)
    .maybeSingle()
  if (engErr) throw new Error(`Engagement lookup failed: ${engErr.message}`)
  if (!eng) return null

  const { data: deliv, error: delErr } = await supabase
    .from("coach_client_engagement_deliverables")
    .select("id, engagement_id")
    .eq("id", deliverableId)
    .maybeSingle()
  if (delErr) throw new Error(`Deliverable lookup failed: ${delErr.message}`)
  if (!deliv || deliv.engagement_id !== engagementId) return null

  return { deliverableId: deliv.id as string }
}

/**
 * A deliverable's activities in the shape the unlock rule reads.
 *
 * Every coach write that can change a deliverable's lock state loads this
 * first, applies the edit IN MEMORY, and compares — see requireConfirm below.
 */
export async function loadDeliverableActivities(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<ProofActivity[]> {
  const { data, error } = await supabase
    .from("coach_client_engagement_activities")
    .select("id, name, owner, status, due_date, sort_order, created_at, is_signoff")
    .eq("engagement_deliverable_id", deliverableId)
  if (error) throw new Error(`Activity load failed: ${error.message}`)
  return ((data ?? []) as ProofActivity[]).sort(byOrder)
}

/**
 * THE HARD CONFIRM, ENFORCED SERVER-SIDE.
 *
 * A dialog in the coach's browser is a suggestion; this is the rule. Two edits
 * demand an explicit `confirm: true` in the body:
 *
 *   - deleting the sign-off activity, ALWAYS, because it is the row the whole
 *     unlock hangs on and re-creating it is not a one-click undo;
 *   - any edit that would take a deliverable from signed-off back to locked,
 *     because the client may have been reading that speaking point for weeks
 *     and it would simply vanish.
 *
 * Returns the reason when confirmation is required and none was given, so the
 * route can 409 with copy the UI shows verbatim rather than inventing its own.
 */
export function requireConfirm(args: {
  before: ProofActivity[]
  next: ProofActivity[]
  deletingSignoff?: boolean
  confirmed: boolean
}): { blocked: true; reason: string; kind: "signoff_delete" | "relock" } | { blocked: false } {
  if (args.confirmed) return { blocked: false }
  if (args.deletingSignoff) {
    return {
      blocked: true,
      kind: "signoff_delete",
      reason:
        "That's the sign-off task for this deliverable — the one that unlocks the client's speaking point. Deleting it leaves the deliverable with no sign-off.",
    }
  }
  if (wouldRelock(args.before, args.next)) {
    return {
      blocked: true,
      kind: "relock",
      reason:
        "This deliverable is signed off, and this change would lock it again. If the client has seen their speaking point, it will disappear.",
    }
  }
  return { blocked: false }
}

// ── Resolver: client_profile_id + coach → the single coach_clients.id ──
// UNIQUE(coach_profile_id, client_profile_id) guarantees at most one. Returns
// null if this coach has no relationship row for that client profile. The linked
// client page resolves this, then calls the coach-clients/[id]/engagements routes.
export async function resolveCoachClientId(
  supabase: SupabaseClient,
  coachProfileId: string,
  clientProfileId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_clients")
    .select("id")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .maybeSingle()
  if (error) throw new Error(`Relationship lookup failed: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}

// ── Row shapes / selects ──
export type EngagementRow = {
  id: string
  coach_client_id: string
  source_package_id: string | null
  name: string
  discount_cents: number | null
  proposal_status: string
  is_proof_project: boolean
  attached_at: string
  created_at: string
  updated_at: string
}
export const ENGAGEMENT_SELECT =
  "id, coach_client_id, source_package_id, name, discount_cents, proposal_status, is_proof_project, attached_at, created_at, updated_at"

type EngDeliverableRow = {
  id: string
  engagement_id: string
  name: string
  category: string | null
  time_estimate_days: number | null
  fee_cents: number | null
  speaking_point: string | null
  why_this_matters: string | null
  sort_order: number
  created_at: string
}
const ENG_DELIVERABLE_SELECT =
  "id, engagement_id, name, category, time_estimate_days, fee_cents, speaking_point, why_this_matters, sort_order, created_at"

type EngActivityRow = {
  id: string
  engagement_deliverable_id: string
  name: string
  owner: string
  status: string
  due_date: string | null
  is_signoff: boolean
  sort_order: number
  created_at: string
}
const ENG_ACTIVITY_SELECT =
  "id, engagement_deliverable_id, name, owner, status, due_date, is_signoff, sort_order, created_at"

function toApiEngActivity(a: EngActivityRow) {
  return { id: a.id, name: a.name, owner: a.owner, status: a.status, due_date: a.due_date, is_signoff: a.is_signoff, sort_order: a.sort_order }
}

function toApiEngDeliverable(d: EngDeliverableRow, activities: ReturnType<typeof toApiEngActivity>[]) {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    time_estimate_days: d.time_estimate_days,
    fee: d.fee_cents === null ? null : d.fee_cents / 100, // dollars at the edge
    speaking_point: d.speaking_point,
    why_this_matters: d.why_this_matters,
    sort_order: d.sort_order,
    activities,
  }
}

// Assemble API engagements (deliverables[] each with activities[] + pricing in
// DOLLARS) for a set of already-owned engagement rows. One query for the
// snapshot deliverables, one for their activities, then nested + priced.
export async function toApiEngagements(supabase: SupabaseClient, rows: EngagementRow[]) {
  if (rows.length === 0) return []
  const engagementIds = rows.map((r) => r.id)

  const { data: delivData, error: delivErr } = await supabase
    .from("coach_client_engagement_deliverables")
    .select(ENG_DELIVERABLE_SELECT)
    .in("engagement_id", engagementIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (delivErr) throw new Error(`Failed to read engagement deliverables: ${delivErr.message}`)
  const delivs = (delivData ?? []) as EngDeliverableRow[]

  const delivIds = delivs.map((d) => d.id)
  const activitiesByDeliv = new Map<string, EngActivityRow[]>()
  if (delivIds.length) {
    const { data: actData, error: actErr } = await supabase
      .from("coach_client_engagement_activities")
      .select(ENG_ACTIVITY_SELECT)
      .in("engagement_deliverable_id", delivIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (actErr) throw new Error(`Failed to read engagement activities: ${actErr.message}`)
    for (const a of (actData ?? []) as EngActivityRow[]) {
      const list = activitiesByDeliv.get(a.engagement_deliverable_id) ?? []
      list.push(a)
      activitiesByDeliv.set(a.engagement_deliverable_id, list)
    }
  }

  const delivsByEngagement = new Map<string, EngDeliverableRow[]>()
  for (const d of delivs) {
    const list = delivsByEngagement.get(d.engagement_id) ?? []
    list.push(d)
    delivsByEngagement.set(d.engagement_id, list)
  }

  return rows.map((e) => {
    const myDelivs = delivsByEngagement.get(e.id) ?? []
    const deliverables = myDelivs.map((d) =>
      toApiEngDeliverable(d, (activitiesByDeliv.get(d.id) ?? []).map(toApiEngActivity)),
    )

    // Pricing over the FROZEN snapshot — integer cents, dollars at the edge.
    // Identical math to toApiPackage.
    const subtotalCents = myDelivs.reduce((sum, d) => sum + (d.fee_cents ?? 0), 0)
    const unpricedCount = myDelivs.filter((d) => d.fee_cents === null).length
    const discountCents = e.discount_cents // null = no discount
    const effectiveDiscountCents = Math.min(discountCents ?? 0, subtotalCents) // clamp
    const totalCents = subtotalCents - effectiveDiscountCents // >= 0 by construction
    const discountClamped = discountCents !== null && discountCents > subtotalCents

    return {
      id: e.id,
      name: e.name,
      proposal_status: e.proposal_status,
      is_proof_project: e.is_proof_project,
      attached_at: e.attached_at,
      discount: discountCents === null ? null : discountCents / 100,
      deliverables,
      pricing: {
        subtotal: subtotalCents / 100,
        unpriced_count: unpricedCount,
        effective_discount: effectiveDiscountCents / 100,
        total: totalCents / 100,
        discount_clamped: discountClamped,
      },
    }
  })
}

// List a coach_client's engagements (newest first), assembled + priced.
export async function listApiEngagements(supabase: SupabaseClient, coachClientId: string) {
  const { data, error } = await supabase
    .from("coach_client_engagements")
    .select(ENGAGEMENT_SELECT)
    .eq("coach_client_id", coachClientId)
    .order("attached_at", { ascending: false })
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Failed to read engagements: ${error.message}`)
  return toApiEngagements(supabase, (data as EngagementRow[]) ?? [])
}

// Read one engagement, but only if it belongs to coachClientId (the dual check:
// engagement.coach_client_id must match the [id] in the path). null otherwise.
export async function getApiEngagementById(
  supabase: SupabaseClient,
  coachClientId: string,
  engagementId: string,
) {
  const { data, error } = await supabase
    .from("coach_client_engagements")
    .select(ENGAGEMENT_SELECT)
    .eq("id", engagementId)
    .eq("coach_client_id", coachClientId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read engagement: ${error.message}`)
  if (!data) return null
  const [api] = await toApiEngagements(supabase, [data as EngagementRow])
  return api
}
