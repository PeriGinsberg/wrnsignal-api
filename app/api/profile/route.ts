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
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

const PROFILE_SELECT =
  "id, user_id, email, name, job_type, target_roles, target_locations, preferred_locations, timeline, resume_text, profile_text, profile_structured, profile_version, updated_at"

/**
 * When the intake form sends everything as a single blob, the individual
 * columns (name, job_type, etc.) stay NULL. This parser extracts known
 * fields from profile_text so the dashboard can display them properly.
 * Returns only the fields that were successfully parsed (non-empty).
 */
function parseFieldsFromProfileText(text: string): Record<string, string> {
  if (!text) return {}
  const out: Record<string, string> = {}

  const grab = (pattern: RegExp): string => {
    const m = text.match(pattern)
    return m?.[1]?.trim() || ""
  }

  const name = grab(/^Name:\s*(.+)/im)
  if (name) out.name = name

  const jobType = grab(/Job Type(?:\s+Preference)?:\s*(.+)/i)
  if (jobType) out.job_type = jobType

  const roles = grab(/Primary Roles:\s*(.+?)(?:\s*Secondary Roles:|$)/im)
  if (roles) out.target_roles = roles.replace(/\.\s*$/, "").trim()

  const prefLoc = grab(/Preferred Locations?:\s*(.+)/i)
  if (prefLoc) out.preferred_locations = prefLoc

  const timeline = grab(/Timeline:\s*(.+?)(?:\s+Feedback Style:|$)/i)
  if (timeline) out.timeline = timeline.trim()

  // Extract just the resume (everything after "Resume Text:" or "Resume:")
  const resumeMatch = text.match(/(?:Resume Text|Resume):\s*\n?([\s\S]+?)(?:\n(?:Cover Letter Text|Writing Samples|Extra Context|Other Concerns|Strengths):|\s*$)/i)
  if (resumeMatch?.[1]?.trim() && resumeMatch[1].trim().length > 50) {
    out.resume_text = resumeMatch[1].trim()
  }

  return out
}

/** Backfill NULL fields from profile_text, update DB + fix persona. */
async function backfillProfileFields(profile: any, supabase: any) {
  if (!profile?.profile_text) return profile
  // Only backfill if key fields are still NULL
  if (profile.name && profile.job_type && profile.target_roles) return profile

  const parsed = parseFieldsFromProfileText(profile.profile_text)
  if (!Object.keys(parsed).length) return profile

  const updates: Record<string, any> = {}
  if (!profile.name && parsed.name) updates.name = parsed.name
  if (!profile.job_type && parsed.job_type) updates.job_type = parsed.job_type
  if (!profile.target_roles && parsed.target_roles) updates.target_roles = parsed.target_roles
  if (!profile.preferred_locations && parsed.preferred_locations) updates.preferred_locations = parsed.preferred_locations
  if (!profile.timeline && parsed.timeline) updates.timeline = parsed.timeline
  if (parsed.resume_text) updates.resume_text = parsed.resume_text

  if (!Object.keys(updates).length) return profile

  // Update profile row
  const { data: updated } = await supabase
    .from("client_profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", profile.id)
    .select(PROFILE_SELECT)
    .single()

  // Fix any persona whose resume_text contains profile metadata (e.g. "Name:" prefix)
  if (parsed.resume_text) {
    const { data: personas } = await supabase
      .from("client_personas")
      .select("id, resume_text")
      .eq("profile_id", profile.id)

    if (personas?.length) {
      for (const p of personas) {
        const pText = String(p.resume_text || "")
        // If persona text starts with profile metadata, replace with just the resume
        if (pText.match(/^Name:/i) || pText.length > parsed.resume_text.length * 1.5) {
          await supabase
            .from("client_personas")
            .update({ resume_text: parsed.resume_text, updated_at: new Date().toISOString() })
            .eq("id", p.id)
        }
      }
    }
  }

  return updated || { ...profile, ...updates }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const supabase = getSupabaseAdmin()

    // 1) Lookup by user_id
    const { data: byUserId, error } = await supabase
      .from("client_profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw new Error(`Profile lookup failed: ${error.message}`)
    if (byUserId) {
      const filled = await backfillProfileFields(byUserId, supabase)
      return withCorsJson(req, { ok: true, profile: filled })
    }

    // 2) Fallback: lookup by email and attach user_id
    if (email) {
      const { data: byEmail, error: emailErr } = await supabase
        .from("client_profiles")
        .select(PROFILE_SELECT)
        .eq("email", email)
        .maybeSingle()

      if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)

      if (byEmail) {
        if (byEmail.user_id === userId) {
          const filled = await backfillProfileFields(byEmail, supabase)
          return withCorsJson(req, { ok: true, profile: filled })
        }
        // user_id is missing or stale (auth user was recreated) — re-attach
        const { data: attached, error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
          .select(PROFILE_SELECT)
          .single()

        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
        const filled = await backfillProfileFields(attached, supabase)
        return withCorsJson(req, { ok: true, profile: filled })
      }
    }

    // 3) No profile exists at all — auto-create
    const { data: created, error: createErr } = await supabase
      .from("client_profiles")
      .insert({
        user_id: userId,
        email,
        profile_text: "",
        updated_at: new Date().toISOString(),
      })
      .select(PROFILE_SELECT)
      .single()

    if (createErr) throw new Error(`Profile create failed: ${createErr.message}`)
    return withCorsJson(req, { ok: true, profile: created })
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
