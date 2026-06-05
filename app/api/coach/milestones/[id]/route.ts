// app/api/coach/milestones/[id]/route.ts
//
// Coach Deliverables catalog — per-row edit/delete (Phase 1: PATCH + DELETE).
// Per-row REST (NOT pipeline's batch PUT). Auth / scoping / CORS / mapper are
// copied verbatim from app/api/coach/milestones/route.ts so this file is
// self-contained (per the inlined coach-route convention).
//
// Routes:
//   PATCH  — partial update; allow-listed fields only. Matches the row on BOTH
//            id (URL) AND coach_profile_id (token) → 404 if not found / not owned.
//   DELETE — hard delete (nothing references milestones in Phase 1). Same
//            id + coach_profile_id match → 404 if not found / not owned.
//
// SECURITY: coach_milestones has NO RLS — scoping is enforced here. The coach id
// always comes from the bearer token, never the URL or body. Every query filters
// on coach_profile_id.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type MilestoneRow = {
  id: string
  coach_profile_id: string
  name: string
  description: string | null
  category: string | null
  sort_order: number
  active: boolean
  time_estimate_days: number | null
  fee_cents: number | null
  created_at: string
  updated_at: string
}

const MILESTONE_SELECT =
  "id, coach_profile_id, name, description, category, sort_order, active, time_estimate_days, fee_cents, created_at, updated_at"

// ── Auth helpers (inlined per coach-route convention; copied from
//    app/api/coach/milestones/route.ts) ──
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, coach_org")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

function toApiMilestone(r: MilestoneRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    sort_order: r.sort_order,
    active: r.active,
    time_estimate_days: r.time_estimate_days,
    // DB stores cents; the client only ever sees dollars. null = unpriced.
    fee: r.fee_cents === null ? null : r.fee_cents / 100,
  }
}

// Parse an optional fee given in DOLLARS into integer cents for the DB.
// null / undefined / "" → null (unpriced, NOT 0). Otherwise must be a finite
// number >= 0; Math.round(dollars * 100) avoids binary-float drift
// (e.g. 150.50 → 15050, never 15049).
function parseFeeToCents(v: unknown): { cents: number | null } | { error: string } {
  if (v === undefined || v === null || v === "") return { cents: null }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return { error: "fee must be a number >= 0 (dollars)" }
  }
  return { cents: Math.round(v * 100) }
}

// Parse optional time_estimate_days (fractional days OK, e.g. 0.5).
// null / undefined / "" → null. Otherwise must be a finite number >= 0.
function parseTimeEstimateDays(v: unknown): { days: number | null } | { error: string } {
  if (v === undefined || v === null || v === "") return { days: null }
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    return { error: "time_estimate_days must be a number >= 0" }
  }
  return { days: v }
}

// Resolve { coachProfileId } or return an error Response (401/403/404).
async function resolveCoach(req: NextRequest) {
  const { userId, email } = await getAuthedUser(req)
  const coach = await getCoachProfile(userId, email)
  if (!coach) return { error: withCorsJson(req, { ok: false, error: "Profile not found" }, 404) }
  if (!coach.is_coach) return { error: withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403) }
  return { coachProfileId: coach.id as string }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: single deliverable + its ordered activities[] ──
// Activities are the sub-resource in coach_milestone_activities (ordered by
// sort_order then created_at). The list endpoint returns only activity_count;
// the full array lives here.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const supabase = getSupabaseAdmin()
    const { data: milestone, error: mErr } = await supabase
      .from("coach_milestones")
      .select(MILESTONE_SELECT)
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .maybeSingle()
    if (mErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read milestone: ${mErr.message}` }, 500)
    }
    if (!milestone) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    const { data: acts, error: aErr } = await supabase
      .from("coach_milestone_activities")
      .select("id, name, owner, sort_order")
      .eq("milestone_id", id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (aErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read activities: ${aErr.message}` }, 500)
    }

    return withCorsJson(req, {
      ok: true,
      milestone: { ...toApiMilestone(milestone as MilestoneRow), activities: acts ?? [] },
    })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ── PATCH: partial update (allow-listed fields), scoped to the coach ──
const PATCH_ALLOWED = new Set([
  "name",
  "description",
  "category",
  "active",
  "sort_order",
  "time_estimate_days",
  "fee",
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    // Allow-list discipline: reject any key outside the editable set.
    const unknown = Object.keys(body).filter((k) => !PATCH_ALLOWED.has(k))
    if (unknown.length) {
      return withCorsJson(req, { ok: false, error: `Unknown field(s): ${unknown.join(", ")}` }, 400)
    }

    const updates: Record<string, any> = {}

    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return withCorsJson(req, { ok: false, error: "name cannot be empty" }, 400)
      }
      updates.name = body.name.trim()
    }
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        return withCorsJson(req, { ok: false, error: "description must be a string or null" }, 400)
      }
      const v = typeof body.description === "string" ? body.description.trim() : ""
      updates.description = v ? v : null
    }
    if ("category" in body) {
      if (body.category !== null && typeof body.category !== "string") {
        return withCorsJson(req, { ok: false, error: "category must be a string or null" }, 400)
      }
      const v = typeof body.category === "string" ? body.category.trim() : ""
      updates.category = v ? v : null
    }
    if ("active" in body) {
      if (typeof body.active !== "boolean") {
        return withCorsJson(req, { ok: false, error: "active must be a boolean" }, 400)
      }
      updates.active = body.active
    }
    if ("sort_order" in body) {
      if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) {
        return withCorsJson(req, { ok: false, error: "sort_order must be an integer" }, 400)
      }
      updates.sort_order = body.sort_order
    }
    if ("time_estimate_days" in body) {
      const parsed = parseTimeEstimateDays(body.time_estimate_days)
      if ("error" in parsed) {
        return withCorsJson(req, { ok: false, error: parsed.error }, 400)
      }
      updates.time_estimate_days = parsed.days
    }
    // Client sends `fee` in DOLLARS; the column is fee_cents. fee:null → unpriced.
    if ("fee" in body) {
      const parsed = parseFeeToCents(body.fee)
      if ("error" in parsed) {
        return withCorsJson(req, { ok: false, error: parsed.error }, 400)
      }
      updates.fee_cents = parsed.cents
    }

    if (Object.keys(updates).length === 0) {
      return withCorsJson(req, { ok: false, error: "No updatable fields supplied" }, 400)
    }

    const supabase = getSupabaseAdmin()
    // Match BOTH id and coach_profile_id → a row owned by another coach (or a
    // nonexistent id) matches nothing → 404 (not found / not owned).
    const { data: updated, error: upErr } = await supabase
      .from("coach_milestones")
      .update(updates)
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select(MILESTONE_SELECT)
      .maybeSingle()
    if (upErr) {
      return withCorsJson(req, { ok: false, error: `Failed to update milestone: ${upErr.message}` }, 500)
    }
    if (!updated) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    return withCorsJson(req, { ok: true, milestone: toApiMilestone(updated as MilestoneRow) })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ── DELETE: hard delete, scoped to the coach ──
//
// Guard: coach_package_milestones FKs this row with ON DELETE RESTRICT, so a
// deliverable that's in any package can't be deleted. We check that up front
// and return a clean 409 (+ the referencing package names) rather than letting
// Postgres throw the raw 23503. Behavior-preserving when it's in no package.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { coachProfileId, error: authErr } = await resolveCoach(req)
    if (authErr) return authErr

    const supabase = getSupabaseAdmin()

    // Ownership first — never leak package references for a milestone the coach
    // doesn't own.
    const { data: owned, error: ownErr } = await supabase
      .from("coach_milestones")
      .select("id")
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .maybeSingle()
    if (ownErr) {
      return withCorsJson(req, { ok: false, error: `Failed to read milestone: ${ownErr.message}` }, 500)
    }
    if (!owned) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    // RESTRICT guard: refuse with 409 if this deliverable is used in any package.
    const { data: links, error: linkErr } = await supabase
      .from("coach_package_milestones")
      .select("package_id")
      .eq("milestone_id", id)
    if (linkErr) {
      return withCorsJson(req, { ok: false, error: `Failed to check package references: ${linkErr.message}` }, 500)
    }
    if (links && links.length) {
      const pkgIds = [...new Set(links.map((l: any) => l.package_id))]
      const { data: pkgs } = await supabase
        .from("coach_packages")
        .select("name")
        .in("id", pkgIds)
        .eq("coach_profile_id", coachProfileId)
      const names = (pkgs ?? []).map((p: any) => p.name as string)
      const first = names[0] ?? "a package"
      const others = Math.max(0, names.length - 1)
      const msg =
        others > 0
          ? `Can't delete — used in '${first}' and ${others} other package${others > 1 ? "s" : ""}.`
          : `Can't delete — used in '${first}'.`
      return withCorsJson(req, { ok: false, error: msg, packages: names }, 409)
    }

    // Match BOTH id and coach_profile_id; .select() returns the deleted row so we
    // can distinguish a real delete from a no-op (not found / not owned → 404).
    const { data: deleted, error: delErr } = await supabase
      .from("coach_milestones")
      .delete()
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
      .select("id")
      .maybeSingle()
    if (delErr) {
      return withCorsJson(req, { ok: false, error: `Failed to delete milestone: ${delErr.message}` }, 500)
    }
    if (!deleted) {
      return withCorsJson(req, { ok: false, error: "Milestone not found" }, 404)
    }

    return withCorsJson(req, { ok: true, deleted: (deleted as { id: string }).id })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
