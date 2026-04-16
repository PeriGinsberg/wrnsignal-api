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
  "id, user_id, email, name, job_type, target_roles, target_locations, preferred_locations, timeline, resume_text, profile_text, profile_structured, profile_version, profile_complete, is_coach, coach_org, active, purchase_date, refunded_at, updated_at"

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

  // Grab a tab/multi-space separated field: "Label    Value"
  const grabField = (label: string): string => {
    const m = text.match(new RegExp(`^${label}[\\t ]+(.+)`, "im"))
    return m?.[1]?.trim() || ""
  }

  // --- Name ---
  // Format A: "Name:Reece Kauffman" or "Name: Reece Kauffman"
  const nameColon = grab(/^Name:\s*(.+)/im)
  // Format B: "First Name    Jacob\nLast Name    Kanterman"
  const firstName = grabField("First Name")
  const lastName = grabField("Last Name")
  const nameCombined = [firstName, lastName].filter(Boolean).join(" ")
  const name = nameColon || nameCombined
  if (name) out.name = name

  // --- Job Type ---
  const jobType = grab(/Job Type(?:\s+Preference)?:\s*(.+)/i)
    || grabField("Job Type Preference")
    || grabField("Job Type")
  if (jobType) out.job_type = jobType

  // --- Target Roles ---
  const roles = grab(/Primary Roles:\s*(.+?)(?:\s*Secondary Roles:|$)/im)
    || grabField("\\d+\\.\\s*What types of roles are you targeting[^\\t]*")
    || grabField("Target Roles")
  if (roles) out.target_roles = roles.replace(/\.\s*$/, "").replace(/^\d+\.\s*/, "").trim()

  // --- Preferred Locations ---
  const prefLoc = grab(/Preferred Locations?:\s*(.+)/i)
    || grabField("Preferred Locations?")
    || grabField("Where do you want to work")
  if (prefLoc) out.preferred_locations = prefLoc

  // --- Timeline ---
  const timeline = grab(/Timeline:\s*(.+?)(?:\s+Feedback Style:|$)/i)
    || grabField("Timeline")
    || grabField("When do you need")
  if (timeline) out.timeline = timeline.trim()

  // --- Resume text (everything after the resume section marker) ---
  const resumeMatch = text.match(/(?:Resume Text|Resume|Paste your resume)[\s:]*\n([\s\S]+?)(?:\n(?:Cover Letter Text|Writing Samples|Extra Context|Other Concerns|Strengths):|\s*$)/i)
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

/** Recompute profile_complete from the 5 required fields; silently fix if stale. */
async function healProfileComplete(profile: any, supabase: any) {
  if (!profile) return profile
  const expected = !!(
    profile.name && profile.resume_text && profile.target_roles &&
    profile.target_locations
  )
  if (profile.profile_complete === expected) return profile
  await supabase
    .from("client_profiles")
    .update({ profile_complete: expected })
    .eq("id", profile.id)
  profile.profile_complete = expected
  return profile
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
      const healed = await healProfileComplete(filled, supabase)
      return withCorsJson(req, { ok: true, profile: healed })
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
          const healed = await healProfileComplete(filled, supabase)
          return withCorsJson(req, { ok: true, profile: healed })
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
        const healed = await healProfileComplete(filled, supabase)
        return withCorsJson(req, { ok: true, profile: healed })
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

    // Rebuild canonical profile_text from individual fields so the scoring
    // engine gets targeting context (target_roles, job_type, constraints, etc.)
    // alongside the resume. Without this, dashboard-edited profiles have an
    // empty profile_text and the scorer runs blind on targeting info.
    // Also recompute profile_complete on every save — it must not depend on
    // which fields the client happened to include in this request.
    if (updated) {
      try {
        const p = updated as any
        const lines: string[] = []
        const add = (label: string, val: any) => {
          const v = String(val || "").trim()
          if (v) lines.push(`${label}: ${v}`)
        }
        add("Name", p.name)
        add("Job type", p.job_type)
        add("Target roles", p.target_roles)
        add("Target locations", p.target_locations)
        add("Preferred locations", p.preferred_locations)
        add("Timeline", p.timeline)
        const resume = String(p.resume_text || "").trim()
        if (resume) lines.push(`\nResume:\n${resume}`)
        const profileText = lines.join("\n").trim()

        const profileComplete = !!(
          p.name && p.resume_text && p.target_roles && p.target_locations
        )

        const patch: Record<string, any> = { profile_complete: profileComplete }
        if (profileText) patch.profile_text = profileText

        await supabase
          .from("client_profiles")
          .update(patch)
          .eq("id", existing.id)
        if (profileText) (updated as any).profile_text = profileText
        ;(updated as any).profile_complete = profileComplete
      } catch (rebuildErr: any) {
        console.warn("[profile] profile_text rebuild failed:", rebuildErr.message)
      }
    }

    return withCorsJson(req, { ok: true, profile: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
