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

type ClientProfileCoreRow = {
  id: string
  email: string | null
  user_id: string | null
  profile_text: string | null
}

/**
 * Builds a minimal fallback profile text when profile_text is missing.
 * This avoids schema dependency on optional columns like name/job_type/etc.
 */
function buildMinimalProfileText(row: ClientProfileCoreRow, fallbackEmail: string) {
  const email = String(row.email || fallbackEmail).trim().toLowerCase()

  return `
Email: ${email}

Profile:
(No profile_text found yet. Please re-submit intake or contact support.)
`.trim()
}

async function fetchProfileByUserId(userId: string): Promise<ClientProfileCoreRow | null> {
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select("id,email,user_id,profile_text")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

async function fetchProfileByEmail(email: string): Promise<ClientProfileCoreRow | null> {
  const normalized = String(email || "").trim().toLowerCase()

  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select("id,email,user_id,profile_text")
    .ilike("email", normalized)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

/**
 * Attach profile row to auth user id.
 * Race-safe: only attaches if user_id is NULL.
 */
async function attachProfileToUser(profileId: string, userId: string): Promise<ClientProfileCoreRow | null> {
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .update({ user_id: userId })
    .eq("id", profileId)
    .is("user_id", null)
    .select("id,email,user_id,profile_text")
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as any) ?? null
}

/**
 * Backfill profile_text for stability (optional).
 * If this fails, do not block the user.
 */
async function persistProfileText(profileId: string, profileText: string) {
  const { error } = await supabaseAdmin
    .from("client_profiles")
    .update({ profile_text: profileText })
    .eq("id", profileId)

  if (error) {
    return
  }
}

export async function getAuthedProfileText(req: Request): Promise<{
  userId: string
  email: string
  profileText: string
}> {
  const token = getBearerToken(req)

  // 1) Validate token and get the auth user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) throw new Error("Unauthorized: invalid token")

  const userId = userData.user.id
  const email = String(userData.user.email || "").trim().toLowerCase()
  if (!email) throw new Error("Unauthorized: email missing on user")

  // 2) First try: profile already attached to user_id
  const byId = await fetchProfileByUserId(userId)
  if (byId) {
    const profileText =
      (byId.profile_text && String(byId.profile_text).trim()) ||
      buildMinimalProfileText(byId, email)

    // Optional: backfill missing profile_text
    if (!byId.profile_text && profileText) {
      await persistProfileText(byId.id, profileText)
    }

    return { userId, email, profileText }
  }

  // 3) Fallback: find profile by email (intake-created row)
  const byEmail = await fetchProfileByEmail(email)
  if (!byEmail) {
    throw new Error("Profile not found")
  }

  // 4) If profile is already attached to a different auth user, block
  if (byEmail.user_id && String(byEmail.user_id) !== String(userId)) {
    throw new Error("Access disabled")
  }

  // 5) Attach user_id (race-safe). Update by id, not email.
  const attached = await attachProfileToUser(byEmail.id, userId)

  // If attach did nothing because another request attached first, refetch by user_id
  const finalRow = attached ?? (await fetchProfileByUserId(userId)) ?? byEmail

  const profileText =
    (finalRow.profile_text && String(finalRow.profile_text).trim()) ||
    buildMinimalProfileText(finalRow, email)

  if (!finalRow.profile_text && profileText) {
    await persistProfileText(finalRow.id, profileText)
  }

  return { userId, email, profileText }
}
