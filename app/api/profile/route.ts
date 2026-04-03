// app/api/profile/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
  return { userId: data.user.id }
}

const PROFILE_SELECT =
  "id, user_id, email, name, job_type, target_roles, target_locations, preferred_locations, timeline, resume_text, profile_structured, profile_version, updated_at"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getAuthedUser(req)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("client_profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw new Error(`Profile lookup failed: ${error.message}`)
    if (!data) return withCorsJson(req, { error: "Profile not found" }, 404)

    return withCorsJson(req, { ok: true, profile: data })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await getAuthedUser(req)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    // Fetch current profile to confirm ownership
    const { data: existing, error: lookupErr } = await supabase
      .from("client_profiles")
      .select("id, profile_version")
      .eq("user_id", userId)
      .maybeSingle()

    if (lookupErr) throw new Error(`Profile lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Profile not found" }, 404)

    // Strip fields that must not be changed via this route
    const { email, id, user_id, seat_id, profile_version, ...allowed } = body

    const { data: updated, error: updateErr } = await supabase
      .from("client_profiles")
      .update({
        ...allowed,
        profile_version: (existing.profile_version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(PROFILE_SELECT)
      .single()

    if (updateErr) throw new Error(`Profile update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, profile: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
