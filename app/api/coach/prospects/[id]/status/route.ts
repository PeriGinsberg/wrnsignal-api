// app/api/coach/prospects/[id]/status/route.ts
//
// Per-prospect status (configurable pipeline, build step 3).
// Spec: docs/Features/prospect-configurable-pipeline-spec.md §5.3, §7.
//
// Route:
//   PATCH — set prospect_status. Body: { prospect_status }.
//     - Allowed values: 'active' | 'inactive' | 'lost' ONLY.
//     - 'won' is NOT settable here — it is automatic on reaching the terminal
//       Convert stage (§4). Reject 'won' with 400.
//     - Updates ONLY coach_clients.prospect_status. lifecycle_status is NEVER
//       touched here — the two columns are independent (§5.3).
//
// Auth: standard coach Bearer pattern (matches the sibling routes).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Coach-settable values only. 'won' is intentionally excluded (automatic on
// convert, §4). This is the server-side allow-list (v0.1 lesson).
const SETTABLE_STATUSES = ["active", "inactive", "lost"] as const

// ── Auth helpers (inlined per coach-route convention; copied from
//    the sibling stage/route.ts) ──
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

async function verifyProspectOwnership(coachClientId: string, coachProfileId: string, supabase: any) {
  const { data } = await supabase
    .from("coach_clients")
    .select("id")
    .eq("id", coachClientId)
    .eq("coach_profile_id", coachProfileId)
    .eq("status", "active")
    .maybeSingle()
  return data ?? null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ════════════════════════════════════════════════════════════════
// PATCH /api/coach/prospects/[id]/status — set prospect_status
// ════════════════════════════════════════════════════════════════
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coach = await getCoachProfile(userId, email)
    if (!coach) return withCorsJson(req, { ok: false, error: "Profile not found" }, 404)
    if (!coach.is_coach) return withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403)
    const coachProfileId = coach.id as string

    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "id is required" }, 400)

    const body = await req.json().catch(() => null)
    const status = body && typeof body === "object" ? (body as any).prospect_status : undefined

    // 'won' is explicitly rejected here (automatic on convert, §4) — distinct
    // message from a generic invalid value so the caller understands why.
    if (status === "won") {
      return withCorsJson(req, { ok: false, error: "'won' is set automatically on convert, not here" }, 400)
    }
    if (typeof status !== "string" || !(SETTABLE_STATUSES as readonly string[]).includes(status)) {
      return withCorsJson(req, {
        ok: false,
        error: `prospect_status must be one of: ${SETTABLE_STATUSES.join(", ")}`,
      }, 400)
    }

    const supabase = getSupabaseAdmin()

    const prospect = await verifyProspectOwnership(id, coachProfileId, supabase)
    if (!prospect) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    // Allow-listed single-column update. lifecycle_status is NOT in this
    // payload and is never touched here (§5.3).
    const { error: updErr } = await supabase
      .from("coach_clients")
      .update({ prospect_status: status })
      .eq("id", id)
      .eq("coach_profile_id", coachProfileId)
    if (updErr) return withCorsJson(req, { ok: false, error: `Failed to update status: ${updErr.message}` }, 500)

    return withCorsJson(req, { ok: true, prospect_status: status })
  } catch (e: any) {
    const msg = e?.message || String(e)
    const status = /unauthorized/i.test(msg) ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
