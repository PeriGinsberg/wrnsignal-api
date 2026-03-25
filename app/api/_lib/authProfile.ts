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

type AuthedProfile = {
  profileId: string
  profileText: string
  resumeText: string
  profileStructured: Record<string, any> | null
  jobType: string | null
  targetRoles: string | null
  targetLocations: string | null
  preferredLocations: string | null
  timeline: string | null
}

const PROFILE_SELECT = "id,user_id,email,profile_text,resume_text,profile_structured,job_type,target_roles,target_locations,timeline"

function rowToProfile(row: ClientProfileRow): AuthedProfile {
  return {
    profileId: row.id,
    profileText: row.profile_text || "",
    resumeText: row.resume_text || "",
    profileStructured: row.profile_structured || null,
    jobType: row.job_type || null,
    targetRoles: row.target_roles || null,
    targetLocations: row.target_locations || null,
        timeline: row.timeline || null,
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

export async function getAuthedProfileText(req: Request): Promise<AuthedProfile> {
  const { userId, email } = await getAuthedUser(req)

  // 1) Prefer lookup by user_id
  const { data: byUserId, error: byUserErr } = await supabaseAdmin
    .from("client_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle<ClientProfileRow>()

  if (byUserErr) throw new Error(`Profile lookup failed: ${byUserErr.message}`)
  if (byUserId?.id) return rowToProfile(byUserId)

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
    return rowToProfile(created)
  }

  // 2) Try lookup by email
  const { data: byEmail, error: byEmailErr } = await supabaseAdmin
    .from("client_profiles")
    .select(PROFILE_SELECT)
    .eq("email", email)
    .maybeSingle<ClientProfileRow>()

  if (byEmailErr) throw new Error(`Profile lookup by email failed: ${byEmailErr.message}`)

  if (byEmail?.id) {
    if (byEmail.user_id === userId) return rowToProfile(byEmail)

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
        if (raced?.id) return rowToProfile(raced)
      }
      throw new Error(`Profile attach failed: ${attachErr?.message || "unknown"}`)
    }

    return rowToProfile(attached)
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

      if (existingByEmail.user_id === userId) return rowToProfile(existingByEmail)

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
      return rowToProfile(attached)
    }

    throw new Error(`Profile create failed: ${createErr.message}`)
  }

  if (!created) throw new Error("Profile create failed: unknown")
  return rowToProfile(created)
}