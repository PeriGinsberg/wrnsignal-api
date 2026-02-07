
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const url = requireEnv("SUPABASE_URL", SUPABASE_URL)
const service = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY)

const supabaseAdmin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)

  // Canonical validation: ask Supabase to validate this JWT and return the user.
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
  }
}

type ClientProfileRow = {
  id: string
  email: string | null
  user_id: string | null
  profile_text: string | null
  risk_overrides?: any
}

/**
 * API owns profile creation + attachment.
 * Client never writes to client_profiles.
 */
export async function getAuthedProfileText(req: Request): Promise<{ profileText: string }> {
  const { userId, email } = await getAuthedUser(req)

  // Try to fetch profile by user_id (auth.users.id)
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("client_profiles")
    .select("id,user_id,email,profile_text")
    .eq("user_id", userId)
    .maybeSingle<ClientProfileRow>()

  if (findErr) throw new Error(`Profile lookup failed: ${findErr.message}`)

  // If no profile row exists yet, create one owned by this user_id.
  if (!existing) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from("client_profiles")
      .insert({
        user_id: userId,
        email,
        profile_text: "",
        updated_at: new Date().toISOString(),
      })
      .select("id,user_id,email,profile_text")
      .single<ClientProfileRow>()

    if (createErr || !created) {
      throw new Error(`Profile create failed: ${createErr?.message || "unknown"}`)
    }

    return { profileText: created.profile_text || "" }
  }

  return { profileText: existing.profile_text || "" }
}

