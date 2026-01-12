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

async function fetchProfileByUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text,email,user_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

async function fetchProfileByEmail(email: string) {
  // Try exact first
  const exact = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text,email,user_id")
    .eq("email", email)
    .maybeSingle()

  if (exact.error) throw new Error(exact.error.message)
  if (exact.data?.profile_text) return exact.data

  // Case-insensitive fallback
  const ilike = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text,email,user_id")
    .ilike("email", email)
    .maybeSingle()

  if (ilike.error) throw new Error(ilike.error.message)
  return ilike.data
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

  // 2) Try fetch by user_id (already linked)
  const byId = await fetchProfileByUserId(userId)
  if (byId?.profile_text) {
    return { userId, email, profileText: byId.profile_text }
  }

  // 3) Fallback: fetch by email (case-insensitive)
  const byEmail = await fetchProfileByEmail(email)

  if (!byEmail?.profile_text) {
    // Helpful error for you (still safe for users)
    throw new Error("Profile not found")
  }

  // 4) If row is already attached to a different auth user, block
  if (byEmail.user_id && String(byEmail.user_id) !== String(userId)) {
    throw new Error("Access disabled")
  }

  // 5) Attach user_id on first login (race-safe)
  const { error: attachErr } = await supabaseAdmin
    .from("client_profiles")
    .update({ user_id: userId })
    .eq("email", String(byEmail.email).trim())
    .is("user_id", null)

  if (attachErr) {
    // Race fallback
    const retry = await fetchProfileByUserId(userId)
    if (retry?.profile_text) {
      return { userId, email, profileText: retry.profile_text }
    }
    throw new Error(attachErr.message)
  }

  return { userId, email, profileText: byEmail.profile_text }
}
