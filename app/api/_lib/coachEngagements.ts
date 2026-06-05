// app/api/_lib/coachEngagements.ts
//
// Shared building blocks for the Client Engagement API — a sub-resource of
// coach_clients (coach_client_engagements + …_deliverables + …_activities).
// Auth / scoping is REUSED from ./coachPackages (the same generic coach-route
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

// Reuse the generic coach-route auth/scoping helpers (the recent worked example).
export { getSupabaseAdmin, resolveCoach, errStatus, UUID_RE } from "./coachPackages"

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
  attached_at: string
  created_at: string
  updated_at: string
}
export const ENGAGEMENT_SELECT =
  "id, coach_client_id, source_package_id, name, discount_cents, proposal_status, attached_at, created_at, updated_at"

type EngDeliverableRow = {
  id: string
  engagement_id: string
  name: string
  category: string | null
  time_estimate_days: number | null
  fee_cents: number | null
  sort_order: number
  created_at: string
}
const ENG_DELIVERABLE_SELECT =
  "id, engagement_id, name, category, time_estimate_days, fee_cents, sort_order, created_at"

type EngActivityRow = {
  id: string
  engagement_deliverable_id: string
  name: string
  owner: string
  status: string
  sort_order: number
  created_at: string
}
const ENG_ACTIVITY_SELECT =
  "id, engagement_deliverable_id, name, owner, status, sort_order, created_at"

function toApiEngActivity(a: EngActivityRow) {
  return { id: a.id, name: a.name, owner: a.owner, status: a.status, sort_order: a.sort_order }
}

function toApiEngDeliverable(d: EngDeliverableRow, activities: ReturnType<typeof toApiEngActivity>[]) {
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    time_estimate_days: d.time_estimate_days,
    fee: d.fee_cents === null ? null : d.fee_cents / 100, // dollars at the edge
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
