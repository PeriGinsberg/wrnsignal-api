// app/api/coach/clients/[clientId]/coaches/route.ts
//
// Manage collaborating coaches on a client (Shape 1, flat CRM-shared).
// [clientId] = client_profile_id.
//
//   GET    — list active collaborating coaches (+ names).
//   POST   — add a coach by email: insert a coach_clients row (same client,
//            different coach_profile_id — legal per the (coach_profile_id,
//            client_profile_id) unique constraint). If a soft-revoked row for
//            that coach exists, re-activate it (the unique constraint blocks a
//            second insert).
//   DELETE — soft-revoke a coach (status='revoked'); never the last coach.
//            Soft, not hard: coach_client_notes.coach_client_id is ON DELETE
//            CASCADE, so a hard delete would destroy the removed coach's
//            authored notes — which the shared feed must preserve.
//
// Auth: caller must have FULL access to the client (verifyCoachAccess).
// Seat cap intentionally NOT touched (double-count is accepted debt).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string
  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }
  throw new Error("Profile not found")
}

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = {
    view: ["view", "annotate", "full"],
    annotate: ["annotate", "full"],
    full: ["full"],
  }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── GET: list active collaborating coaches ──
export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)

    const { data: rows, error } = await supabase
      .from("coach_clients")
      .select("coach_profile_id, access_level")
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
    if (error) throw new Error(`Coach list failed: ${error.message}`)

    const coachIds = Array.from(new Set((rows ?? []).map((r: any) => r.coach_profile_id as string)))
    const nameById = new Map<string, string | null>()
    if (coachIds.length) {
      const { data: profs } = await supabase.from("client_profiles").select("id, name").in("id", coachIds)
      for (const p of profs ?? []) nameById.set(p.id as string, (p.name as string | null) ?? null)
    }
    const coaches = (rows ?? []).map((r: any) => ({
      coach_profile_id: r.coach_profile_id,
      name: nameById.get(r.coach_profile_id as string) ?? null,
      access_level: r.access_level,
      is_self: r.coach_profile_id === profileId,
    }))
    return withCorsJson(req, { ok: true, coaches })
  } catch (err: any) {
    const msg = err?.message || String(err)
    return withCorsJson(req, { ok: false, error: msg }, /unauthorized/i.test(msg) ? 401 : 500)
  }
}

// ── POST: add a coach by email ──
export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)

    const body = await req.json().catch(() => null)
    const coachEmail = typeof body?.coach_email === "string" ? body.coach_email.trim().toLowerCase() : ""
    if (!EMAIL_RE.test(coachEmail)) return withCorsJson(req, { ok: false, error: "Valid coach_email is required" }, 400)

    const { data: coachProfile } = await supabase
      .from("client_profiles")
      .select("id, is_coach")
      .eq("email", coachEmail)
      .maybeSingle()
    if (!coachProfile) return withCorsJson(req, { ok: false, error: "No account found for that email" }, 404)
    if (!coachProfile.is_coach) return withCorsJson(req, { ok: false, error: "That account is not a coach" }, 400)
    const newCoachId = coachProfile.id as string

    // Existing (coach, client) row? Unique constraint blocks a second insert.
    const { data: existing } = await supabase
      .from("coach_clients")
      .select("id, status")
      .eq("coach_profile_id", newCoachId)
      .eq("client_profile_id", clientProfileId)
      .maybeSingle()
    if (existing) {
      if (existing.status === "active") {
        return withCorsJson(req, { ok: false, error: "That coach is already on this client" }, 409)
      }
      // Re-activate a soft-revoked collaborator (their historical notes stay).
      const { error: reErr } = await supabase.from("coach_clients").update({ status: "active" }).eq("id", existing.id)
      if (reErr) throw new Error(`Re-activate failed: ${reErr.message}`)
      return withCorsJson(req, { ok: true, reactivated: true })
    }

    const { data: client } = await supabase.from("client_profiles").select("email").eq("id", clientProfileId).maybeSingle()
    const { error: insErr } = await supabase.from("coach_clients").insert({
      coach_profile_id: newCoachId,
      client_profile_id: clientProfileId,
      invited_email: client?.email ?? null,
      access_level: "full",
      status: "active",
      accepted_at: new Date().toISOString(),
      lifecycle_status: "Active",
    })
    if (insErr) throw new Error(`Add coach failed: ${insErr.message}`)
    return withCorsJson(req, { ok: true }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    return withCorsJson(req, { ok: false, error: msg }, /unauthorized/i.test(msg) ? 401 : 500)
  }
}

// ── DELETE: soft-revoke a coach (never the last one) ──
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)

    const body = await req.json().catch(() => null)
    const targetCoachId = typeof body?.coach_profile_id === "string" ? body.coach_profile_id.trim() : ""
    if (!targetCoachId) return withCorsJson(req, { ok: false, error: "coach_profile_id is required" }, 400)

    // Last-coach guard: a client must always keep at least one active coach.
    const { count, error: countErr } = await supabase
      .from("coach_clients")
      .select("id", { count: "exact", head: true })
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
    if (countErr) throw new Error(`Coach count failed: ${countErr.message}`)
    if ((count ?? 0) <= 1) {
      return withCorsJson(req, { ok: false, error: "A client must keep at least one coach" }, 409)
    }

    const { error: delErr } = await supabase
      .from("coach_clients")
      .update({ status: "revoked" })
      .eq("coach_profile_id", targetCoachId)
      .eq("client_profile_id", clientProfileId)
      .eq("status", "active")
    if (delErr) throw new Error(`Remove coach failed: ${delErr.message}`)
    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    return withCorsJson(req, { ok: false, error: msg }, /unauthorized/i.test(msg) ? 401 : 500)
  }
}
