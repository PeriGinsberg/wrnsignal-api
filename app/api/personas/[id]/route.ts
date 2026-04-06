// app/api/personas/[id]/route.ts
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const { id: personaId } = await params
    const supabase = getSupabaseAdmin()

    // Verify persona belongs to this profile
    const { data: existing, error: lookupErr } = await supabase
      .from("client_personas")
      .select("id, persona_version, profile_id")
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

    // If setting as default, clear default on all other personas first
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
    const profileId = await getProfileId(userId, email)
    const { id: personaId } = await params
    const supabase = getSupabaseAdmin()

    // Verify persona belongs to this profile
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

    // If deleted persona was default, promote the remaining one
    if (existing.is_default) {
      const { data: remaining } = await supabase
        .from("client_personas")
        .select("id")
        .eq("profile_id", profileId)
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
