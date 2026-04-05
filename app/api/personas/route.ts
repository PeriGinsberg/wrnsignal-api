// app/api/personas/route.ts
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
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()

  // 1) Lookup by user_id
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  // 2) Fallback: lookup by email and attach user_id
  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)

    if (byEmail) {
      if (byEmail.user_id !== userId) {
        // user_id missing or stale — re-attach
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

const PERSONA_SELECT =
  "id, name, resume_text, is_default, display_order, persona_version, created_at, updated_at"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("client_personas")
      .select(PERSONA_SELECT)
      .eq("profile_id", profileId)
      .order("display_order", { ascending: true })

    if (error) throw new Error(`Personas lookup failed: ${error.message}`)

    return withCorsJson(req, { ok: true, personas: data || [] })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401
      : lower.includes("not found") ? 404
      : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Enforce max 2
    const { count, error: countErr } = await supabase
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)

    if (countErr) throw new Error(`Persona count failed: ${countErr.message}`)
    if ((count ?? 0) >= 2) {
      return withCorsJson(req, { ok: false, error: "Maximum 2 personas allowed" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const name = String(body.name || "").trim()
    if (!name) return withCorsJson(req, { error: "name is required" }, 400)

    const resume_text = String(body.resume_text || "").trim()
    const isFirst = (count ?? 0) === 0
    const display_order = isFirst ? 1 : 2

    const { data, error } = await supabase
      .from("client_personas")
      .insert({
        profile_id: profileId,
        name,
        resume_text,
        is_default: isFirst,
        display_order,
      })
      .select(PERSONA_SELECT)
      .single()

    if (error) throw new Error(`Persona create failed: ${error.message}`)

    return withCorsJson(req, { ok: true, persona: data }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401
      : lower.includes("not found") ? 404
      : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
