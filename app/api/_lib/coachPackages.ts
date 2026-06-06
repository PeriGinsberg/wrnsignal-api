// app/api/_lib/coachPackages.ts
//
// Shared building blocks for the Coach Packages API (CRUD + deliverable linking
// + live pricing). The auth / scoping helpers below are byte-identical to
// app/api/coach/milestones/route.ts — bearer → authed user → coach profile →
// is_coach → scope EVERY query on coach_profile_id. They live here (rather than
// re-inlined) because the packages feature spans four route files; the
// auth/scoping FLOW mirrors milestones exactly.
//
// SECURITY: coach_packages / coach_package_milestones have NO RLS — scoping is
// enforced in these helpers and their callers. The coach id always comes from
// the bearer token, never the body or URL. Link ops additionally enforce DUAL
// ownership (the package AND every milestone must belong to the coach) so a
// coach can't link another coach's deliverable by guessing a UUID.

import { type SupabaseClient } from "@supabase/supabase-js"

// Generic coach-route auth/scoping moved to ./coachAuth (a neutral home). Re-
// exported here so the packages route files that import auth from this module
// keep working unchanged.
export { getSupabaseAdmin, resolveCoach, errStatus, UUID_RE } from "./coachAuth"

// ── Money: dollars at the edge, integer cents in the DB, null ≠ 0 ──
// Parse an optional discount given in DOLLARS into integer cents.
// null / undefined / "" → null (no discount). Otherwise a finite number >= 0;
// Math.round(dollars * 100) avoids binary-float drift.
export function parseDiscountToCents(v: unknown): { cents: number | null } | { error: string } {
  if (v === undefined || v === null || v === "") return { cents: null }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return { error: "discount must be a number >= 0 (dollars)" }
  }
  return { cents: Math.round(v * 100) }
}

// ── Row shapes / selects ──
export type PackageRow = {
  id: string
  coach_profile_id: string
  name: string
  description: string | null
  discount_cents: number | null
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}
export const PACKAGE_SELECT =
  "id, coach_profile_id, name, description, discount_cents, active, sort_order, created_at, updated_at"

type LinkedMilestoneRow = {
  id: string
  name: string
  description: string | null
  category: string | null
  sort_order: number
  active: boolean
  time_estimate_days: number | null
  fee_cents: number | null
}
const LINKED_MILESTONE_SELECT =
  "id, name, description, category, sort_order, active, time_estimate_days, fee_cents"

// Deliverable as exposed to the client — same dollars-at-the-edge mapping as
// the milestones API (fee in dollars, fee_cents never leaked).
function toApiDeliverable(m: LinkedMilestoneRow) {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    sort_order: m.sort_order,
    active: m.active,
    time_estimate_days: m.time_estimate_days,
    fee: m.fee_cents === null ? null : m.fee_cents / 100,
  }
}

// Dual-ownership: which of `milestoneIds` are NOT owned by this coach.
// Returns the foreign/missing ids (empty array = all owned). Dedups input.
export async function findUnownedMilestones(
  supabase: SupabaseClient,
  coachProfileId: string,
  milestoneIds: string[],
): Promise<string[]> {
  const ids = [...new Set(milestoneIds)]
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from("coach_milestones")
    .select("id")
    .eq("coach_profile_id", coachProfileId)
    .in("id", ids)
  if (error) throw new Error(`Ownership check failed: ${error.message}`)
  const owned = new Set((data as { id: string }[]).map((r) => r.id))
  return ids.filter((id) => !owned.has(id))
}

// Assemble API packages (deliverables[] + pricing in DOLLARS) for a set of
// already coach-scoped package rows. One query for the join rows, one for the
// referenced milestones (scoped to the coach), then pricing computed in
// integer cents and converted to dollars at the edge.
export async function toApiPackages(
  supabase: SupabaseClient,
  coachProfileId: string,
  rows: PackageRow[],
) {
  if (rows.length === 0) return []
  const packageIds = rows.map((r) => r.id)

  const { data: joinData, error: joinErr } = await supabase
    .from("coach_package_milestones")
    .select("package_id, milestone_id, sort_order, created_at")
    .in("package_id", packageIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (joinErr) throw new Error(`Failed to read package links: ${joinErr.message}`)
  const joins = (joinData ?? []) as {
    package_id: string; milestone_id: string; sort_order: number; created_at: string
  }[]

  const milestoneIds = [...new Set(joins.map((j) => j.milestone_id))]
  const milestoneById = new Map<string, LinkedMilestoneRow>()
  if (milestoneIds.length) {
    const { data: msData, error: msErr } = await supabase
      .from("coach_milestones")
      .select(LINKED_MILESTONE_SELECT)
      .eq("coach_profile_id", coachProfileId) // scope: only this coach's deliverables
      .in("id", milestoneIds)
    if (msErr) throw new Error(`Failed to read deliverables: ${msErr.message}`)
    for (const m of (msData ?? []) as LinkedMilestoneRow[]) milestoneById.set(m.id, m)
  }

  const joinsByPackage = new Map<string, typeof joins>()
  for (const j of joins) {
    const list = joinsByPackage.get(j.package_id) ?? []
    list.push(j)
    joinsByPackage.set(j.package_id, list)
  }

  return rows.map((p) => {
    const pkgJoins = joinsByPackage.get(p.id) ?? []
    // Preserve join order; drop any link whose milestone isn't owned by the
    // coach (defensive — dual-ownership on link should make this impossible).
    const linked = pkgJoins
      .map((j) => milestoneById.get(j.milestone_id))
      .filter((m): m is LinkedMilestoneRow => !!m)
    const deliverables = linked.map(toApiDeliverable)

    // Pricing — all in integer cents, converted to dollars at the edge.
    const subtotalCents = linked.reduce((sum, m) => sum + (m.fee_cents ?? 0), 0)
    const unpricedCount = linked.filter((m) => m.fee_cents === null).length
    const discountCents = p.discount_cents // null = no discount
    const effectiveDiscountCents = Math.min(discountCents ?? 0, subtotalCents) // clamp
    const totalCents = subtotalCents - effectiveDiscountCents // >= 0 by construction
    const discountClamped = discountCents !== null && discountCents > subtotalCents

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      active: p.active,
      sort_order: p.sort_order,
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

// Convenience: re-read one coach-scoped package row and assemble it, or null
// (not found / not owned). Used to return the fresh package after a write.
export async function getApiPackageById(
  supabase: SupabaseClient,
  coachProfileId: string,
  packageId: string,
) {
  const { data, error } = await supabase
    .from("coach_packages")
    .select(PACKAGE_SELECT)
    .eq("id", packageId)
    .eq("coach_profile_id", coachProfileId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read package: ${error.message}`)
  if (!data) return null
  const [api] = await toApiPackages(supabase, coachProfileId, [data as PackageRow])
  return api
}
