// app/api/personas/route.ts
//
// Self-service persona endpoints — any authenticated user can manage
// their OWN personas. Security gate: each operation scopes to the
// caller's client_profiles.id (resolved from auth.uid via getProfile()).
//
// History note:
//   Sprint 1 (2026-05-07) disabled POST/PUT/DELETE entirely under a pilot
//   constraint ("coach manages your personas"). Sprint 3 re-enabled them
//   for is_coach only. Sprint 3 correction (also 2026-05-08) widened to
//   all authenticated users — the original pilot constraint was over-
//   broad. D2C users without coaches need to manage their own personas;
//   coach-managed clients can also self-edit alongside coach edits.
//
// Coaches managing their CLIENTS' personas use a separate route family
// at /api/coach/clients/[clientId]/personas/* with its own auth path
// (active coach_clients link required, full access_level).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

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

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profile = await getProfile(userId, email)
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from("client_personas")
      .select(PERSONA_SELECT)
      .eq("profile_id", profile.id)
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
    const profile = await getProfile(userId, email)
    const supabase = getSupabaseAdmin()

    // Cap at 10 active personas per profile, harmonized with the coach-
    // side cap on /api/coach/clients/[id]/personas. Same value for all
    // self-edit cases (D2C, coach-on-self, coach-managed-client-on-self).
    const { count, error: countErr } = await supabase
      .from("client_personas")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profile.id)
    if (countErr) throw new Error(`Persona count failed: ${countErr.message}`)
    if ((count ?? 0) >= 10) {
      return withCorsJson(req, { ok: false, error: "Maximum 10 personas allowed" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const name = String(body.name || "").trim()
    if (!name) return withCorsJson(req, { error: "name is required" }, 400)
    const resume_text = String(body.resume_text || "")
    const isFirst = (count ?? 0) === 0
    const display_order = (count ?? 0) + 1

    const { data, error } = await supabase
      .from("client_personas")
      .insert({
        profile_id: profile.id,
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
