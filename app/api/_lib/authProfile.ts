import { createClient } from "@supabase/supabase-js"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function getEnv() {
  return {
    SUPABASE_URL: requireEnv("SUPABASE_URL"),
    SUPABASE_ANON_KEY: requireEnv("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  }
}

type AuthedUser = {
  id: string
  email: string
}

export async function getAuthedUserFromRequest(req: Request): Promise<AuthedUser> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = getEnv()

  const auth = req.headers.get("authorization") || ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : ""

  if (!token) {
    throw new Error("Unauthorized: missing Bearer token")
  }

  const supabaseUserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabaseUserClient.auth.getUser()

  const userId = data?.user?.id
  const email = data?.user?.email

  if (error || !userId || !email) {
    throw new Error("Unauthorized: invalid session")
  }

  return { id: userId, email: email.toLowerCase() }
}

export async function getProfileTextByUserId(userId: string): Promise<string> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv()

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text, active")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error("Profile lookup failed.")
  }

  if (!data) {
    throw new Error("Profile not found for this user.")
  }

  if (data.active === false) {
    throw new Error("Access disabled.")
  }

  if (!data.profile_text || !data.profile_text.trim()) {
    throw new Error("Profile is empty.")
  }

  return data.profile_text.trim()
}

export async function getAuthedProfileText(req: Request): Promise<{
  email: string
  profileText: string
}> {
  const user = await getAuthedUserFromRequest(req)
  const profileText = await getProfileTextByUserId(user.id)
  return { email: user.email, profileText }
}
