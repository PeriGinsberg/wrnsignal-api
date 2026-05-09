// app/api/coach/clients/[clientId]/personas/route.ts
//
// Coach-side persona list + create. Mirrors the auth pattern used by
// ../profile/route.ts (verifyCoachAccess against coach_clients).
// Pilot constraint (2026-05-07): writes require access_level = 'full'.
//
// Persona cap: 10 active personas per client. The historical client-self-
// service /api/personas endpoint capped at 2; pilot raised to 10. The cap
// counts NON-archived personas only — archived ones don't consume slots.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PERSONA_CAP_PER_CLIENT = 10

const PERSONA_SELECT =
  "id, profile_id, name, resume_text, is_default, display_order, persona_version, archived_at, created_at, updated_at"

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
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      return byEmail.id as string
    }
  }
  throw new Error("Profile not found")
}

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: "view" | "annotate" | "full", supabase: any) {
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

// Coaches reading the persona list. Returns active + archived.
// The UI sorts: default first, other active by created_at desc, archived last.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "view", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: no active coach relationship" }, 403)
    }

    const { data, error } = await supabase
      .from("client_personas")
      .select(PERSONA_SELECT)
      .eq("profile_id", clientProfileId)
      .order("created_at", { ascending: false })

    if (error) throw new Error(`Personas lookup failed: ${error.message}`)
    return withCorsJson(req, { ok: true, personas: data || [] })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const name = String(body.name || "").trim()
    if (!name) return withCorsJson(req, { ok: false, error: "name is required" }, 400)
    const resume_text = String(body.resume_text || "")

    // Cap counts active (non-archived) personas only
    const { count, error: countErr } = await supabase
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", clientProfileId)
      .is("archived_at", null)
    if (countErr) throw new Error(`Persona count failed: ${countErr.message}`)

    if ((count ?? 0) >= PERSONA_CAP_PER_CLIENT) {
      return withCorsJson(req, {
        ok: false,
        error: `Maximum ${PERSONA_CAP_PER_CLIENT} active personas per client (archive one to add another)`,
      }, 403)
    }

    // First-ever persona becomes the default automatically.
    const isFirst = (count ?? 0) === 0

    const { data: inserted, error: insErr } = await supabase
      .from("client_personas")
      .insert({
        profile_id: clientProfileId,
        name,
        resume_text,
        is_default: isFirst,
        display_order: (count ?? 0) + 1,
      })
      .select(PERSONA_SELECT)
      .single()

    if (insErr || !inserted) throw new Error(`Persona create failed: ${insErr?.message ?? "no row"}`)

    // If this is the new default (i.e. first persona on this client), sync
    // resume_text and profile_complete to client_profiles so the scoring
    // engine sees a resume on file. Same gotcha as the existing
    // /api/personas/[id] PUT route — must mirror.
    if (isFirst && resume_text.trim().length > 0) {
      try {
        const { data: prof } = await supabase
          .from("client_profiles")
          .select("name, target_roles, target_locations")
          .eq("id", clientProfileId)
          .single()
        const profileComplete = !!(
          prof?.name && resume_text.trim() && prof?.target_roles && prof?.target_locations
        )
        await supabase
          .from("client_profiles")
          .update({
            resume_text: resume_text,
            profile_complete: profileComplete,
            updated_at: new Date().toISOString(),
          })
          .eq("id", clientProfileId)
      } catch (syncErr: any) {
        console.warn("[coach personas POST] resume sync failed:", syncErr.message)
      }
    }

    return withCorsJson(req, { ok: true, persona: inserted }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
