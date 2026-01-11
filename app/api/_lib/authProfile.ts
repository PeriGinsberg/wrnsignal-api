import { createClient } from "@supabase/supabase-js"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

const SUPABASE_URL = requireEnv("SUPABASE_URL")
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY")
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY")

export async function getAuthedEmailFromRequest(req: Request): Promise<string> {
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

  if (error || !data?.user?.email) {
    throw new Error("Unauthorized: invalid session")
  }

  return data.user.email.toLowerCase()
}

export async function getProfileTextByEmail(email: string): Promise<string> {
  const supabaseAdmin = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )

  const { data, error } = await supabaseAdmin
    .from("client_profiles")
    .select("profile_text, active")
    .eq("email", email.toLowerCase())
    .single()

  if (error || !data) {
    throw new Error("Profile not found for this email.")
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
  const email = await getAuthedEmailFromRequest(req)
  const profileText = await getProfileTextByEmail(email)
  return { email, profileText }
}
