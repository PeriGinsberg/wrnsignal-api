import { createClient } from "@supabase/supabase-js"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

const SUPABASE_URL = requireEnv("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY")

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) throw new Error("Unauthorized: missing bearer token")
  return m[1]
}

type ClientProfileRow = {
  id: string
  email: string | null
  user_id: string | null
  profile_text: string | null

  // Optional fields that may exist in your table
  name?: string | null
  target_roles?: string | null
  target_locations?: string | null
  preferred_locations?: string | null
  timeline?: string | null
  resume_text?: string | null
  job_type?: string | null
}

function buildProfileTextFromRow(row: ClientProfileRow, fallbackEmail: string) {
  const email = String(row.email || fallbackEmail).trim()

  const name = row.name ? String(row.name).trim() : ""
  const targetRoles = row.target_roles ? String(row.target_roles).trim() : ""

  // Support either column name (some of your code uses target_locations vs preferred_locations)
  const locationsRaw =
    row.target_locations ?? row.preferred_locations ?? row.target_locations
  const locations = locationsRaw ? String(locationsRaw).trim() : ""

  const timeline = row.timeline ? String(row.timeline).trim() : ""
  const resumeText = row.resume_text ? String(row.resume_text).trim() : ""

  const jobType = row.job_type ? String(row.job_type).trim() : ""

  return `
Email: ${email}
Name: ${name}
Job Type: ${jobType}
Target Roles: ${targetRoles}
Preferred Locations: ${locations}
Timeline: ${timeline}

Resume Text:
${resumeText}
`.trim()
}

async function fetchProfileByUserId(userId: string): Promise<ClientProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select(
      "id,email,user_id,profile_text,name,target_roles,target_locations,preferred_locations,timeline,resume_text,job_type"
    )
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

async function fetchProfileByEmail(email: string): Promise<ClientProfileRow | null> {
  // Case-insensitive search
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select(
      "id,email,user_id,profile_text,name,target_roles,target_locations,preferred_locations,timeline,resume_text,job_type"
    )
    .ilike("email", email)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

async function attachProfileToUser(profileId: string, userId: string) {
  // Race-safe: only attach if user_id is null
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .update({ user_id: userId })
    .eq("id", profileId)
    .is("user_id", null)
    .select("id,email,user_id,profile_text,name,target_roles,target_locations,preferred_locations,timeline,resume_text,job_type")
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

async function persistProfileText(profileId: string, profileText: string) {
  const { error } = await supabaseAdmin
    .from("client_profiles")
    .update({ profile_text: profileText })
    .eq("id", profileId)

  if (error) {
    // Do not hard fail the user because caching failed
    return
  }
}

export async function getAuthedProfileText(req: Request): Promise<{
  userId: string
  email: string
  profileText: string
}> {
  const token = getBearerToken(req)

  // 1) Validate token and get user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) throw new Error("Unauthorized: invalid token")

  const userId = userData.user.id
  const email = String(userData.user.email || "").trim().toLowerCase()
  if (!email) throw new Error("Unauthorized: email missing on user")

  // 2) Try fetch by user_id first
  const byId = await fetchProfileByUserId(userId)
  if (byId) {
    const profileText =
      (byId.profile_text && String(byId.profile_text).trim()) ||
      buildProfileTextFromRow(byId, email)

    // Optional: backfill profile_text if missing so future calls are consistent
    if (!byId.profile_text && profileText) {
      await persistProfileText(byId.id, profileText)
    }

    return { userId, email, profileText }
  }

  // 3) Fallback: fetch by email (case-insensitive)
  const byEmail = await fetchProfileByEmail(email)
  if (!byEmail) {
    throw new Error("Profile not found")
  }

  // 4) If already attached to a different auth user, block
  if (byEmail.user_id && String(byEmail.user_id) !== String(userId)) {
    throw new Error("Access disabled")
  }

  // 5) Attach user_id on first login (race-safe). Update by id, not email.
  const attached = await attachProfileToUser(byEmail.id, userId)

  // If attach "did nothing" (because another request attached first), refetch by user_id.
  const finalRow = attached ?? (await fetchProfileByUserId(userId)) ?? byEmail

  const profileText =
    (finalRow.profile_text && String(finalRow.profile_text).trim()) ||
    buildProfileTextFromRow(finalRow, email)

  if (!finalRow.profile_text && profileText) {
    await persistProfileText(finalRow.id, profileText)
  }

  return { userId, email, profileText }
}
