// app/api/resume-rx/save-to-profile/route.ts
// POST /api/resume-rx/save-to-profile
// Creates a new persona from the completed session's final resume.

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

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const session_id = String(body.session_id || "").trim()
    if (!session_id) return withCorsJson(req, { error: "session_id is required" }, 400)

    const supabase = getSupabaseAdmin()

    // Verify session ownership and completion
    const { data: session, error: sessionErr } = await supabase
      .from("resume_rx_sessions")
      .select("id, profile_id, status, final_resume_text, created_at")
      .eq("id", session_id)
      .maybeSingle()

    if (sessionErr) throw new Error(`Session lookup failed: ${sessionErr.message}`)
    if (!session) return withCorsJson(req, { error: "Session not found" }, 404)
    if (session.profile_id !== profileId) return withCorsJson(req, { error: "Forbidden" }, 403)
    if (session.status !== "complete") {
      return withCorsJson(req, { error: "Session is not complete" }, 400)
    }
    if (!session.final_resume_text) {
      return withCorsJson(req, { error: "Session has no final resume text" }, 400)
    }

    // Wave 2 personas refactor (2026-05-06): if the request specifies a
    // target_persona_id and it belongs to this profile, UPDATE that
    // persona's resume_text. Otherwise (default behavior), CREATE a new
    // non-default persona named "Resume Rx — DATE" — keeps the original
    // behavior intact for callers that don't pass target_persona_id, so
    // nothing breaks for the legacy flow.
    const targetPersonaId =
      typeof body?.target_persona_id === "string" && body.target_persona_id.trim().length > 0
        ? body.target_persona_id.trim()
        : null

    if (targetPersonaId) {
      // Verify ownership before update.
      const { data: existing, error: existErr } = await supabase
        .from("client_personas")
        .select("id, name, profile_id, persona_version")
        .eq("id", targetPersonaId)
        .maybeSingle()
      if (existErr) throw new Error(`Persona lookup failed: ${existErr.message}`)
      if (!existing || existing.profile_id !== profileId) {
        return withCorsJson(req, { error: "target_persona_id not found for this profile" }, 404)
      }
      const { data: updated, error: updErr } = await supabase
        .from("client_personas")
        .update({
          resume_text: session.final_resume_text,
          persona_version: (existing.persona_version || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("id, name")
        .single()
      if (updErr) throw new Error(`Persona update failed: ${updErr.message}`)
      return withCorsJson(
        req,
        { ok: true, persona_id: updated.id, persona_name: updated.name, mode: "updated" },
        200
      )
    }

    // Default behavior — create a new non-default persona dated to the
    // session creation time.
    const date = new Date(session.created_at)
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    const persona_name = `Resume Rx — ${dateStr}`

    const { data: persona, error: personaErr } = await supabase
      .from("client_personas")
      .insert({
        profile_id: profileId,
        name: persona_name,
        resume_text: session.final_resume_text,
        is_default: false,
      })
      .select("id, name")
      .single()

    if (personaErr) throw new Error(`Persona create failed: ${personaErr.message}`)

    return withCorsJson(
      req,
      { ok: true, persona_id: persona.id, persona_name: persona.name, mode: "created" },
      201
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[resume-rx/save-to-profile] error:", msg)
    if (msg.includes("Unauthorized")) return withCorsJson(req, { error: msg }, 401)
    if (msg.includes("Profile not found")) return withCorsJson(req, { error: msg }, 404)
    return withCorsJson(req, { error: "Internal error" }, 500)
  }
}
