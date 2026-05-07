// app/api/resume-rx/existing-resume/route.ts
// GET /api/resume-rx/existing-resume
// Returns whether the authed user has an existing resume (from persona or profile).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

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

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Wave 2 personas refactor (2026-05-06): respect explicit persona_id
    // from query param when provided (e.g. /api/resume-rx/existing-resume?persona_id=...).
    // Falls back to default persona, then to client_profiles.resume_text.
    const url = new URL(req.url)
    const explicitPersonaId =
      (url.searchParams.get("persona_id") || "").trim() || null

    // Read order: explicit persona_id → default persona → base profile.
    let persona: { id: string; name: string | null; resume_text: string | null; updated_at: string | null } | null = null

    if (explicitPersonaId) {
      const { data, error } = await supabase
        .from("client_personas")
        .select("id, name, resume_text, updated_at, profile_id")
        .eq("id", explicitPersonaId)
        .maybeSingle()
      if (error) throw new Error(`Persona lookup failed: ${error.message}`)
      // Authorization check — persona must belong to this profile.
      if (data && data.profile_id === profileId) {
        persona = data
      } else if (data && data.profile_id !== profileId) {
        console.warn(
          "[resume-rx/existing-resume] explicit persona_id rejected — does not belong to caller's profile:",
          JSON.stringify({ profileId, requestedPersonaId: explicitPersonaId })
        )
      }
    }

    // Fallback: default persona
    if (!persona) {
      const { data, error } = await supabase
        .from("client_personas")
        .select("id, name, resume_text, updated_at")
        .eq("profile_id", profileId)
        .eq("is_default", true)
        .maybeSingle()
      if (error) throw new Error(`Persona lookup failed: ${error.message}`)
      if (data) persona = data
    }

    if (persona && typeof persona.resume_text === "string" && persona.resume_text.length > 50) {
      return withCorsJson(req, {
        hasResume: true,
        source: "persona",
        personaId: persona.id,
        personaName: persona.name,
        resumePreview: persona.resume_text.slice(0, 300),
        resumeText: persona.resume_text,
        lastUpdated: persona.updated_at,
      })
    }

    // Fallback: check client_profiles.resume_text
    const { data: profile, error: profileErr } = await supabase
      .from("client_profiles")
      .select("id, resume_text, updated_at")
      .eq("id", profileId)
      .maybeSingle()

    if (profileErr) throw new Error(`Profile resume lookup failed: ${profileErr.message}`)

    if (profile && typeof profile.resume_text === "string" && profile.resume_text.length > 50) {
      return withCorsJson(req, {
        hasResume: true,
        source: "profile",
        personaId: null,
        personaName: null,
        resumePreview: profile.resume_text.slice(0, 300),
        resumeText: profile.resume_text,
        lastUpdated: profile.updated_at,
      })
    }

    return withCorsJson(req, { hasResume: false })
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/existing-resume] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
