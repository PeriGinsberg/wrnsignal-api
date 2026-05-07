// app/api/coach/clients/[clientId]/personas/[personaId]/route.ts
//
// Coach-side persona PATCH. Handles all of:
//   - rename (body.name)
//   - update resume body (body.resume_text)
//   - set as primary (body.is_default = true) — clears default on other personas
//   - archive  (body.archive  = true) — sets archived_at = now()
//   - restore  (body.restore  = true) — clears archived_at
//
// Critical gotcha (preserved from /api/personas/[id]/route.ts): when the
// default persona's resume_text changes, OR when this PATCH causes a
// different persona to become the new default, the new default's
// resume_text is mirrored back to client_profiles.resume_text. The
// scoring engine reads from client_profiles.resume_text, not from the
// persona row. profile_text is intake-only and is NOT touched.
//
// Archiving the current default while another active persona exists:
// the most-recently-created active persona is auto-promoted to default
// before the archive completes. If no other active persona exists, the
// archive is rejected (caller must add or designate another first).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PERSONA_SELECT =
  "id, profile_id, name, resume_text, is_default, display_order, persona_version, archived_at, created_at, updated_at"

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
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
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

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, supabase: any) {
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (data.access_level !== "full") return null
  return data
}

// Sync the current default persona's resume_text back to
// client_profiles.resume_text and recompute profile_complete. The scoring
// engine reads client_profiles.resume_text, so this MUST stay in lockstep
// with whichever persona is currently is_default. profile_text is
// intentionally untouched (it's intake-only, owned by /api/profile).
async function syncDefaultPersonaToProfile(supabase: any, clientProfileId: string) {
  const { data: def } = await supabase
    .from("client_personas")
    .select("resume_text")
    .eq("profile_id", clientProfileId)
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle()

  const { data: prof } = await supabase
    .from("client_profiles")
    .select("name, target_roles, target_locations")
    .eq("id", clientProfileId)
    .single()

  const resume = def ? String(def.resume_text || "") : ""
  const profileComplete = !!(
    prof?.name && resume.trim() && prof?.target_roles && prof?.target_locations
  )

  await supabase
    .from("client_profiles")
    .update({
      resume_text: resume.trim().length > 0 ? resume : null,
      profile_complete: profileComplete,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientProfileId)
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string; personaId: string }> }
) {
  try {
    const { clientId: clientProfileId, personaId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    if (!clientProfileId || !personaId) {
      return withCorsJson(req, { ok: false, error: "clientId and personaId required" }, 400)
    }

    const access = await verifyCoachAccess(profileId, clientProfileId, supabase)
    if (!access) {
      return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)
    }

    // Verify persona belongs to this client
    const { data: existing, error: lookupErr } = await supabase
      .from("client_personas")
      .select("id, is_default, archived_at, persona_version, resume_text")
      .eq("id", personaId)
      .eq("profile_id", clientProfileId)
      .maybeSingle()
    if (lookupErr) throw new Error(`Persona lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { ok: false, error: "Persona not found" }, 404)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const updates: Record<string, any> = {
      persona_version: (existing.persona_version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    }

    // ── name ──
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return withCorsJson(req, { ok: false, error: "name cannot be empty" }, 400)
      updates.name = name
    }

    // ── resume_text ──
    if (body.resume_text !== undefined) {
      updates.resume_text = String(body.resume_text)
    }

    // ── set as primary (is_default = true) ──
    // Setting is_default=false directly is not allowed — instead the coach
    // must designate a different persona as primary, which clears this one.
    let willBecomeDefault = false
    if (body.is_default === true) {
      if (existing.archived_at) {
        return withCorsJson(req, { ok: false, error: "Cannot set archived persona as primary; restore it first" }, 400)
      }
      // Clear is_default on all other personas for this client first
      await supabase
        .from("client_personas")
        .update({ is_default: false })
        .eq("profile_id", clientProfileId)
        .neq("id", personaId)
      updates.is_default = true
      willBecomeDefault = true
    }

    // ── archive / restore ──
    let willArchive = false
    let willRestore = false
    if (body.archive === true) {
      if (existing.archived_at) {
        // already archived — no-op for archive_at, but allow other field updates to proceed
      } else {
        if (existing.is_default) {
          // Need to promote another active persona to default first
          const { data: candidates } = await supabase
            .from("client_personas")
            .select("id")
            .eq("profile_id", clientProfileId)
            .neq("id", personaId)
            .is("archived_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
          const promote = candidates?.[0]?.id
          if (!promote) {
            return withCorsJson(req, {
              ok: false,
              error: "Can't archive the only active persona — add another or set a different one as primary first",
            }, 400)
          }
          await supabase
            .from("client_personas")
            .update({ is_default: true })
            .eq("id", promote)
          updates.is_default = false
        }
        updates.archived_at = new Date().toISOString()
        willArchive = true
      }
    } else if (body.restore === true) {
      if (existing.archived_at) {
        updates.archived_at = null
        willRestore = true
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("client_personas")
      .update(updates)
      .eq("id", personaId)
      .select(PERSONA_SELECT)
      .single()
    if (updateErr) throw new Error(`Persona update failed: ${updateErr.message}`)

    // Mirror the current default persona's resume back to client_profiles
    // when anything that could change "what the scoring engine sees" happened.
    const resumeChangedOnDefault = body.resume_text !== undefined && (existing.is_default || willBecomeDefault)
    const defaultChanged = willBecomeDefault || willArchive
    if (resumeChangedOnDefault || defaultChanged) {
      try { await syncDefaultPersonaToProfile(supabase, clientProfileId) }
      catch (syncErr: any) { console.warn("[coach personas PATCH] resume sync failed:", syncErr.message) }
    }

    return withCorsJson(req, { ok: true, persona: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
