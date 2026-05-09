// app/api/personas/[id]/route.ts
//
// Self-service persona update + delete — any authenticated user can
// mutate their OWN personas. Security gate: `.eq("profile_id", profileId)`
// where profileId is resolved from auth.uid → client_profiles.id. A
// coach editing a CLIENT'S personas uses /api/coach/clients/[id]/
// personas/[pid] instead.
//
// History note:
//   Sprint 1 (2026-05-07) returned 410 unconditionally under a pilot
//   constraint. Sprint 3 (2026-05-08) re-enabled for is_coach only.
//   Sprint 3 correction (also 2026-05-08) widened to all authenticated
//   users — original constraint was over-broad. D2C users + coach-
//   managed clients can self-edit; coach maintains parallel edit access
//   via the coach-context routes (last-write-wins between the two
//   surfaces is acceptable for pilot).
//
// Preserved logic: setting is_default=true clears the flag on all other
// personas for this profile; resume_text changes on the default persona
// sync back to client_profiles.resume_text so the scoring engine sees
// the current default body.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PERSONA_SELECT =
  "id, name, resume_text, is_default, display_order, persona_version, created_at, updated_at"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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

async function getProfile(userId: string, email: string | null): Promise<{ id: string; is_coach: boolean }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, user_id, is_coach")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return { id: data.id as string, is_coach: !!data.is_coach }
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, user_id, is_coach")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      return { id: byEmail.id as string, is_coach: !!byEmail.is_coach }
    }
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profile = await getProfile(userId, email)
    const profileId = profile.id
    const { id: personaId } = await params
    const supabase = getSupabaseAdmin()

    // .eq("profile_id", profileId) is the security gate — caller can
    // only mutate personas they own. Coaches operating on a CLIENT's
    // personas hit /api/coach/clients/[clientId]/personas/[personaId].
    const { data: existing, error: lookupErr } = await supabase
      .from("client_personas")
      .select("id, persona_version, profile_id, is_default")
      .eq("id", personaId)
      .eq("profile_id", profileId)
      .maybeSingle()
    if (lookupErr) throw new Error(`Persona lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Persona not found" }, 404)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const updates: Record<string, any> = {
      persona_version: (existing.persona_version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return withCorsJson(req, { error: "name cannot be empty" }, 400)
      updates.name = name
    }
    if (body.resume_text !== undefined) {
      updates.resume_text = String(body.resume_text)
    }

    // Set as default → clear default on all other personas first
    if (body.is_default === true) {
      await supabase
        .from("client_personas")
        .update({ is_default: false })
        .eq("profile_id", profileId)
        .neq("id", personaId)
      updates.is_default = true
    }

    const { data: updated, error: updateErr } = await supabase
      .from("client_personas")
      .update(updates)
      .eq("id", personaId)
      .select(PERSONA_SELECT)
      .single()
    if (updateErr) throw new Error(`Persona update failed: ${updateErr.message}`)

    // Sync default-persona resume_text back to client_profiles.resume_text
    // when the edit affects the default. Scoring engine reads from
    // client_profiles.resume_text, so this MUST stay in lockstep with the
    // current default. profile_text is intake-only — NOT touched here.
    const isDefaultEdit = existing.is_default === true || body.is_default === true
    if (body.resume_text !== undefined && isDefaultEdit) {
      try {
        const { data: prof } = await supabase
          .from("client_profiles")
          .select("name, target_roles, target_locations")
          .eq("id", profileId)
          .single()
        const resumeText = String(body.resume_text || "").trim()
        const profileComplete = !!(
          prof?.name && resumeText && prof?.target_roles && prof?.target_locations
        )
        await supabase
          .from("client_profiles")
          .update({
            resume_text: resumeText || null,
            profile_complete: profileComplete,
            updated_at: new Date().toISOString(),
          })
          .eq("id", profileId)
      } catch (syncErr: any) {
        console.warn("[personas PUT] resume sync to client_profiles failed:", syncErr.message)
      }
    }

    return withCorsJson(req, { ok: true, persona: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401
      : lower.includes("not found") ? 404
      : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profile = await getProfile(userId, email)
    const profileId = profile.id
    const { id: personaId } = await params
    const supabase = getSupabaseAdmin()

    const { data: existing, error: lookupErr } = await supabase
      .from("client_personas")
      .select("id, is_default, profile_id")
      .eq("id", personaId)
      .eq("profile_id", profileId)
      .maybeSingle()
    if (lookupErr) throw new Error(`Persona lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Persona not found" }, 404)

    const { error: deleteErr } = await supabase
      .from("client_personas")
      .delete()
      .eq("id", personaId)
    if (deleteErr) throw new Error(`Persona delete failed: ${deleteErr.message}`)

    // If we deleted the default, promote the most-recently-created remaining persona
    if (existing.is_default) {
      const { data: remaining } = await supabase
        .from("client_personas")
        .select("id")
        .eq("profile_id", profileId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (remaining?.id) {
        await supabase
          .from("client_personas")
          .update({ is_default: true, display_order: 1 })
          .eq("id", remaining.id)
      }
    }

    return withCorsJson(req, { ok: true, deleted: personaId })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const lower = msg.toLowerCase()
    const status = lower.includes("unauthorized") ? 401
      : lower.includes("not found") ? 404
      : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
