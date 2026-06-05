// app/api/coach/milestones/route.ts
//
// Coach Deliverables catalog — per-coach "milestones" (Phase 1: list + create).
// Backed by coach_milestones (dev migration 2026-06-04). Mirrors the auth /
// scoping / CORS conventions of app/api/coach/pipeline/route.ts verbatim.
//
// Routes:
//   GET  — list the authed coach's milestones, ordered sort_order then created_at.
//          No lazy-seed (the catalog starts empty).
//   POST — create one milestone { name, description?, category? }. name required.
//          sort_order = (this coach's max sort_order) + 1. 201 on success.
//
// SECURITY: coach_milestones has NO RLS — scoping is enforced here. Every read
// and write filters on coach_profile_id resolved from the bearer token; the
// client never supplies the coach id.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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
//    app/api/coach/pipeline/route.ts) ──
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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list this coach's milestones (no seeding) ──
export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("coach_milestones")
      .select(MILESTONE_SELECT)
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (error) {
      return withCorsJson(req, { ok: false, error: `Failed to read milestones: ${error.message}` }, 500)
    }
    const rows = (data as MilestoneRow[]) ?? []

    // activity_count per deliverable — count only (the full activities[] array is
    // on GET /milestones/[id]). One grouped query over this coach's rows.
    const countByMilestone = new Map<string, number>()
    const ids = rows.map((m) => m.id)
    if (ids.length) {
      const { data: acts, error: aErr } = await supabase
        .from("coach_milestone_activities")
        .select("milestone_id")
        .in("milestone_id", ids)
      if (aErr) {
        return withCorsJson(req, { ok: false, error: `Failed to read activity counts: ${aErr.message}` }, 500)
      }
      for (const a of (acts ?? []) as { milestone_id: string }[]) {
        countByMilestone.set(a.milestone_id, (countByMilestone.get(a.milestone_id) ?? 0) + 1)
      }
    }

    const milestones = rows.map((m) => ({
      ...toApiMilestone(m),
      activity_count: countByMilestone.get(m.id) ?? 0,
    }))
    return withCorsJson(req, { ok: true, milestones })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ── POST: create one milestone ──
//
// Body: { name: string (required), description?: string, category?: string,
//         time_estimate_days?: number (>=0), fee?: number (>=0, DOLLARS) }
// fee is accepted in dollars and stored as cents (null = unpriced, NOT $0).
// sort_order is server-assigned = (this coach's current max) + 1. The coach id
// comes from the token, never the body.
export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) {
      return withCorsJson(req, { ok: false, error: "name is required" }, 400)
    }
    const description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null
    const category =
      typeof body.category === "string" && body.category.trim() ? body.category.trim() : null

    // fee arrives in DOLLARS, persists as cents; time_estimate_days is stored
    // as-is. Reject bad values here so the error is clean (the DB CHECKs are
    // only a backstop).
    const feeParsed = parseFeeToCents(body.fee)
    if ("error" in feeParsed) {
      return withCorsJson(req, { ok: false, error: feeParsed.error }, 400)
    }
    const timeParsed = parseTimeEstimateDays(body.time_estimate_days)
    if ("error" in timeParsed) {
      return withCorsJson(req, { ok: false, error: timeParsed.error }, 400)
    }

    const supabase = getSupabaseAdmin()

    // Next sort_order = this coach's current max + 1 (scoped to the coach).
    const { data: maxRow, error: maxErr } = await supabase
      .from("coach_milestones")
      .select("sort_order")
      .eq("coach_profile_id", coachProfileId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxErr) {
      return withCorsJson(req, { ok: false, error: `Failed to compute sort_order: ${maxErr.message}` }, 500)
    }
    const nextSortOrder = (typeof maxRow?.sort_order === "number" ? maxRow.sort_order : 0) + 1

    const { data: inserted, error: insErr } = await supabase
      .from("coach_milestones")
      .insert({
        coach_profile_id: coachProfileId,
        name,
        description,
        category,
        sort_order: nextSortOrder,
        time_estimate_days: timeParsed.days,
        fee_cents: feeParsed.cents,
      })
      .select(MILESTONE_SELECT)
      .single()
    if (insErr || !inserted) {
      return withCorsJson(req, { ok: false, error: `Failed to create milestone: ${insErr?.message ?? "unknown error"}` }, 500)
    }

    return withCorsJson(req, { ok: true, milestone: toApiMilestone(inserted as MilestoneRow) }, 201)
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
