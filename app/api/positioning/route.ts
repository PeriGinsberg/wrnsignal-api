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

export async function getAuthedProfileText(req: Request): Promise<{
  userId: string
  email: string
  profileText: string
}> {
  const token = getBearerToken(req)

  // 1) Validate token, get user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) throw new Error("Unauthorized: invalid token")

  const userId = userData.user.id
  const email = String(userData.user.email || "").trim().toLowerCase()
  if (!email) throw new Error("Unauthorized: email missing on user")

  // 2) First try: profile linked to user_id
  const { data: byId, error: byIdErr } = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text,email,user_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (byIdErr) throw new Error(byIdErr.message)
  if (byId?.profile_text) {
    return { userId, email, profileText: byId.profile_text }
  }

  // 3) Fallback: find by email (pre-created row) and attach user_id
  const { data: byEmail, error: byEmailErr } = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text,email,user_id")
    .eq("email", email)
    .maybeSingle()

  if (byEmailErr) throw new Error(byEmailErr.message)
  if (!byEmail?.profile_text) throw new Error("Profile not found")

  // If already attached to a DIFFERENT user_id, block (prevents account sharing)
  if (byEmail.user_id && String(byEmail.user_id) !== String(userId)) {
    throw new Error("Access disabled")
  }

  // Attach user_id on first login
  const { error: attachErr } = await supabaseAdmin
    .from("client_profiles")
    .update({ user_id: userId })
    .eq("email", email)
    .is("user_id", null)

  // If attach failed due to race, we can ignore and just proceed
  if (attachErr) {
    // Try again to fetch by user_id in case another request attached it
    const { data: retry } = await supabaseAdmin
      .from("client_profiles")
      .select("profile_text")
      .eq("user_id", userId)
      .maybeSingle()

    if (retry?.profile_text) {
      return { userId, email, profileText: retry.profile_text }
    }

    // Otherwise bubble error
    throw new Error(attachErr.message)
  }

  return { userId, email, profileText: byEmail.profile_text }
}
