// FILE: app/api/_lib/authProfile.ts

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

type ClientProfileRow = {
  id: string
  email: string | null
  user_id: string | null
  profile_text: string | null
  resume_text: string | null
  profile_structured: Record<string, any> | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  timeline: string | null
}

// Source of the resume_text returned. Used by callers to log when the
// transitional base-profile fallback is being hit (Wave 2 of the personas
// refactor — Wave 3 will eventually retire the fallback). Each call site
// that cares about resume content should log the source so we can track
// how many production runs are still on the legacy path.
export type ResumeSource =
  | "explicit_persona"        // caller passed a personaId, that persona was found
  | "default_persona"         // no personaId passed; used the is_default=true persona
  | "base_profile_fallback"   // no personas exist for this profile (legacy path; should
                              // become rare after Wave 1 migration; eventually impossible
                              // after Wave 3)

type AuthedProfile = {
  profileId: string
  profileText: string
  resumeText: string
  profileStructured: Record<string, any> | null
  jobType: string | null
  targetRoles: string | null
  targetLocations: string | null
   timeline: string | null
  // Wave 2 additions — present on every return so callers can pass through
  // to fingerprint / cache keys and log the source of resume content.
  activePersonaId: string | null
  personaSource: ResumeSource
}

const PROFILE_SELECT = "id,user_id,email,profile_text,resume_text,profile_structured,job_type,target_roles,target_locations,timeline"

// Resolve the resume_text the caller should use, honoring an explicit
// personaId when provided. Read order:
//   1. Explicit personaId — if passed and found for this profile → that
//      persona's resume_text. source = "explicit_persona".
//      If passed but not found, falls through (logs warning).
//   2. Default persona (is_default=true) — always preferred over the
//      base profile column. source = "default_persona".
//   3. Base profile resume_text — transitional fallback for legacy
//      zero-persona profiles. After Wave 1 migration this should be
//      effectively unreachable; logged when hit so we can confirm.
//      source = "base_profile_fallback".
async function resolveResumeText(
  profileId: string,
  baseResumeText: string,
  personaId: string | null
): Promise<{ resumeText: string; activePersonaId: string | null; personaSource: ResumeSource }> {
  // 1) Explicit personaId
  if (personaId) {
    const { data: explicit, error } = await supabaseAdmin
      .from("client_personas")
      .select("id, profile_id, resume_text")
      .eq("id", personaId)
      .maybeSingle<{ id: string; profile_id: string; resume_text: string | null }>()
    if (!error && explicit && explicit.profile_id === profileId) {
      return {
        resumeText: explicit.resume_text || "",
        activePersonaId: explicit.id,
        personaSource: "explicit_persona",
      }
    }
    // Explicit ID didn't resolve. Don't error — fall through to default
    // persona. Log so we can see how often this happens (likely a stale
    // selectedPersonaId in client state after a persona was deleted).
    console.warn(
      "[authProfile] explicit personaId not resolvable; falling through:",
      JSON.stringify({ profileId, personaId, hadRow: !!explicit })
    )
  }

  // 2) Default persona
  const { data: def } = await supabaseAdmin
    .from("client_personas")
    .select("id, resume_text")
    .eq("profile_id", profileId)
    .eq("is_default", true)
    .maybeSingle<{ id: string; resume_text: string | null }>()
  if (def?.id) {
    return {
      resumeText: def.resume_text || "",
      activePersonaId: def.id,
      personaSource: "default_persona",
    }
  }

  // 3) Base profile fallback. Log so we can track legacy paths.
  console.warn(
    "[authProfile] using base_profile_fallback for resume_text — profile has no default persona:",
    JSON.stringify({ profileId, hasBaseResume: baseResumeText.length > 0 })
  )
  return {
    resumeText: baseResumeText,
    activePersonaId: null,
    personaSource: "base_profile_fallback",
  }
}

// Convert a profile row + resolved persona output into the AuthedProfile
// return shape. Used at every termination point of getAuthedProfileText.
async function buildAuthedProfile(
  personaId: string | null,
  row: ClientProfileRow
): Promise<AuthedProfile> {
  const baseResume = row.resume_text || ""
  const resolved = await resolveResumeText(row.id, baseResume, personaId)
  return {
    profileId: row.id,
    profileText: row.profile_text || "",
    resumeText: resolved.resumeText,
    profileStructured: row.profile_structured || null,
    jobType: row.job_type || null,
    targetRoles: row.target_roles || null,
    targetLocations: row.target_locations || null,
    timeline: row.timeline || null,
    activePersonaId: resolved.activePersonaId,
    personaSource: resolved.personaSource,
  }
}

function isDuplicateConstraint(err: any, constraintName?: string) {
  const code = err?.code
  const msg = String(err?.message || "")
  const details = String(err?.details || "")
  const hint = String(err?.hint || "")
  const hitConstraint =
    constraintName &&
    (msg.includes(constraintName) || details.includes(constraintName) || hint.includes(constraintName))
  return code === "23505" || hitConstraint
}

export async function getAuthedProfileText(
  req: Request,
  opts?: { personaId?: string | null }
): Promise<AuthedProfile> {
  const personaId = opts?.personaId ?? null
  const { userId, email } = await getAuthedUser(req)

  // 1) Prefer lookup by user_id
  const { data: byUserId, error: byUserErr } = await supabaseAdmin
    .from("client_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle<ClientProfileRow>()

  if (byUserErr) throw new Error(`Profile lookup failed: ${byUserErr.message}`)
  if (byUserId?.id) return await buildAuthedProfile(personaId,byUserId)

  // If no email, create a user-owned row
  if (!email) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from("client_profiles")
      .insert({
        user_id: userId,
        email: null,
        profile_text: "",
        updated_at: new Date().toISOString(),
      })
      .select(PROFILE_SELECT)
      .single<ClientProfileRow>()

    if (createErr || !created) throw new Error(`Profile create failed: ${createErr?.message || "unknown"}`)
    return await buildAuthedProfile(personaId,created)
  }

  // 2) Try lookup by email
  const { data: byEmail, error: byEmailErr } = await supabaseAdmin
    .from("client_profiles")
    .select(PROFILE_SELECT)
    .eq("email", email)
    .maybeSingle<ClientProfileRow>()

  if (byEmailErr) throw new Error(`Profile lookup by email failed: ${byEmailErr.message}`)

  if (byEmail?.id) {
    if (byEmail.user_id === userId) return await buildAuthedProfile(personaId,byEmail)

    if (byEmail.user_id && byEmail.user_id !== userId) {
      throw new Error(`Profile email conflict: a profile row for ${email} is attached to a different user_id.`)
    }

    // Unowned — attach it
    const { data: attached, error: attachErr } = await supabaseAdmin
      .from("client_profiles")
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq("id", byEmail.id)
      .select(PROFILE_SELECT)
      .single<ClientProfileRow>()

    if (attachErr || !attached) {
      if (isDuplicateConstraint(attachErr, "client_profiles_user_id_key")) {
        const { data: raced, error: racedErr } = await supabaseAdmin
          .from("client_profiles")
          .select(PROFILE_SELECT)
          .eq("user_id", userId)
          .maybeSingle<ClientProfileRow>()

        if (racedErr) throw new Error(`Profile lookup failed: ${racedErr.message}`)
        if (raced?.id) return await buildAuthedProfile(personaId,raced)
      }
      throw new Error(`Profile attach failed: ${attachErr?.message || "unknown"}`)
    }

    return await buildAuthedProfile(personaId,attached)
  }

  // 3) Create fresh row
  const { data: created, error: createErr } = await supabaseAdmin
    .from("client_profiles")
    .insert({
      user_id: userId,
      email,
      profile_text: "",
      updated_at: new Date().toISOString(),
    })
    .select(PROFILE_SELECT)
    .single<ClientProfileRow>()

  if (createErr) {
    if (isDuplicateConstraint(createErr, "client_profiles_email_key")) {
      const { data: existingByEmail, error: reErr } = await supabaseAdmin
        .from("client_profiles")
        .select(PROFILE_SELECT)
        .eq("email", email)
        .maybeSingle<ClientProfileRow>()

      if (reErr) throw new Error(`Profile lookup by email failed: ${reErr.message}`)
      if (!existingByEmail?.id) throw new Error("Profile create failed: duplicate email, but could not re-fetch.")

      if (existingByEmail.user_id === userId) return await buildAuthedProfile(personaId,existingByEmail)

      if (existingByEmail.user_id && existingByEmail.user_id !== userId) {
        throw new Error(`Profile email conflict: a profile row for ${email} is attached to a different user_id.`)
      }

      const { data: attached, error: attachErr } = await supabaseAdmin
        .from("client_profiles")
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq("id", existingByEmail.id)
        .select(PROFILE_SELECT)
        .single<ClientProfileRow>()

      if (attachErr || !attached) throw new Error(`Profile attach failed: ${attachErr?.message || "unknown"}`)
      return await buildAuthedProfile(personaId,attached)
    }

    throw new Error(`Profile create failed: ${createErr.message}`)
  }

  if (!created) throw new Error("Profile create failed: unknown")
  return await buildAuthedProfile(personaId,created)
}