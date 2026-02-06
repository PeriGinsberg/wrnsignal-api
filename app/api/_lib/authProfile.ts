import { createClient } from "@supabase/supabase-js"

/**
 * authProfile.ts (or ../_lib/authProfile.ts)
 *
 * GOALS:
 * 1) Never hard-crash if optional columns do not exist in client_profiles.
 * 2) Stop "Profile not found" by auto-creating a stub client_profiles row on first login.
 * 3) Race-safe linking: attach user_id only if null.
 * 4) Build a usable profileText even if profile_text is null.
 *
 * KEY CHANGE IN THIS REWRITE:
 * - No env var reads and no Supabase client creation at module import time.
 *   We lazy-init the admin client to avoid crashing routes/edge cases when env is misconfigured.
 */

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

let _supabaseAdmin: ReturnType<typeof createClient> | null = null

function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin

  const SUPABASE_URL = requireEnv("SUPABASE_URL")
  const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY")

  _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  return _supabaseAdmin
}

function corsSafeLower(s: any) {
  return String(s || "").trim().toLowerCase()
}

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

  // Optional columns (may or may not exist in DB)
  name?: string | null
  target_roles?: string | null
  target_locations?: string | null
  preferred_locations?: string | null
  timeline?: string | null
  resume_text?: string | null
  job_type?: string | null
}

const SELECT_MIN = "id,email,user_id,profile_text" as const

// If any of these do NOT exist in the DB, PostgREST throws.
// We handle that by trying SELECT_FULL and falling back to SELECT_MIN automatically.
const SELECT_FULL =
  "id,email,user_id,profile_text,name,target_roles,target_locations,preferred_locations,timeline,resume_text,job_type" as const

type SelectResult = { data: any; error: any }

/**
 * Accept a query function that returns either:
 * - A Promise<{data,error}>
 * - A Supabase PostgrestBuilder (thenable) that resolves to {data,error}
 *
 * We always await the returned value.
 */
async function safeSelectSingle<T>(
  queryFn: (selectList: string) => PromiseLike<SelectResult>,
  allowFull = true
): Promise<T | null> {
  // Try FULL first (if enabled), then fall back to MIN if FULL explodes due to missing columns
  if (allowFull) {
    const full = await queryFn(SELECT_FULL)
    if (!full.error) return (full.data as T) ?? null

    // If it's a missing column error, fall through to minimal
    const msg = String(full.error?.message || "")
    const isMissingColumn =
      msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("column")

    if (!isMissingColumn) {
      throw new Error(full.error.message || "Database error")
    }
  }

  const min = await queryFn(SELECT_MIN)
  if (min.error) throw new Error(min.error.message || "Database error")
  return (min.data as T) ?? null
}

function buildProfileTextFromRow(row: ClientProfileRow, fallbackEmail: string) {
  const email = String(row.email || fallbackEmail).trim()
  const name = row.name ? String(row.name).trim() : ""
  const jobType = row.job_type ? String(row.job_type).trim() : ""
  const targetRoles = row.target_roles ? String(row.target_roles).trim() : ""

  const locationsRaw = row.target_locations ?? row.preferred_locations
  const locations = locationsRaw ? String(locationsRaw).trim() : ""

  const timeline = row.timeline ? String(row.timeline).trim() : ""
  const resumeText = row.resume_text ? String(row.resume_text).trim() : ""

  // Keep output stable even if optional fields are missing
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
  const supabaseAdmin = getSupabaseAdmin()
  return safeSelectSingle<ClientProfileRow>(async (selectList) => {
    return await supabaseAdmin
      .from("client_profiles")
      .select(selectList)
      .eq("user_id", userId)
      .maybeSingle()
  })
}

async function fetchProfileByEmail(email: string): Promise<ClientProfileRow | null> {
  const supabaseAdmin = getSupabaseAdmin()
  const e = corsSafeLower(email)
  return safeSelectSingle<ClientProfileRow>(async (selectList) => {
    return await supabaseAdmin
      .from("client_profiles")
      .select(selectList)
      .ilike("email", e)
      .maybeSingle()
  })
}

async function attachProfileToUser(profileId: string, userId: string): Promise<ClientProfileRow | null> {
  const supabaseAdmin = getSupabaseAdmin()

  // Race-safe: only attach if user_id is null
  const attached = await safeSelectSingle<ClientProfileRow>(
    async (selectList) => {
      const supabaseAny = supabaseAdmin as any
      return await supabaseAny
        .from("client_profiles")
        .update({ user_id: userId })
        .eq("id", profileId)
        .is("user_id", null)
        .select(selectList)
        .maybeSingle()
    },
    true
  )

  return attached
}

async function persistProfileText(profileId: string, profileText: string) {
  // Do not break the user flow if this fails
  const supabaseAdmin = getSupabaseAdmin()
  const { error } = await (supabaseAdmin as any)
    .from("client_profiles")
    .update({ profile_text: profileText })
    .eq("id", profileId)

  if (error) return
}

async function createStubProfile(email: string, userId: string): Promise<ClientProfileRow> {
  const supabaseAdmin = getSupabaseAdmin()

  // This prevents "Profile not found" for paid users who authenticated
  // but do not have a client_profiles row yet.
  //
  // Requires a unique constraint on email for best behavior, but will still work without it.
  const e = corsSafeLower(email)

  // Try upsert if email is unique. If it errors, fall back to insert.
  const upsertAttempt = await (supabaseAdmin as any)
    .from("client_profiles")
    .upsert({ email: e, user_id: userId }, { onConflict: "email" })
    .select(SELECT_MIN)
    .maybeSingle()

  if (!upsertAttempt.error && upsertAttempt.data) {
    return upsertAttempt.data as ClientProfileRow
  }

  // Fallback insert (in case onConflict fails because constraint not present)
  const insertAttempt = await (supabaseAdmin as any)
    .from("client_profiles")
    .insert({ email: e, user_id: userId })
    .select(SELECT_MIN)
    .maybeSingle()

  if (insertAttempt.error || !insertAttempt.data) {
    throw new Error(insertAttempt.error?.message || "Failed to create profile")
  }

  return insertAttempt.data as ClientProfileRow
}

export async function getAuthedProfileText(req: Request): Promise<{
  userId: string
  email: string
  profileText: string
}> {
  const token = getBearerToken(req)

  // 1) Validate token and get user
  const supabaseAdmin = getSupabaseAdmin()
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData?.user) throw new Error("Unauthorized: invalid token")

  const userId = String(userData.user.id)
  const email = corsSafeLower(userData.user.email)
  if (!email) throw new Error("Unauthorized: email missing on user")

  // 2) Prefer fetch by user_id
  const byId = await fetchProfileByUserId(userId)
  if (byId) {
    const profileText =
      (byId.profile_text && String(byId.profile_text).trim()) ||
      buildProfileTextFromRow(byId, email)

    if (!byId.profile_text && profileText) {
      await persistProfileText(byId.id, profileText)
    }

    return { userId, email, profileText }
  }

  // 3) Fallback: fetch by email
  let byEmail = await fetchProfileByEmail(email)

  // 3b) If nothing exists, create it now (this is the key to eliminating manual fixes)
  if (!byEmail) {
    byEmail = await createStubProfile(email, userId)
  }

  // 4) If already attached to another user, block
  if (byEmail.user_id && String(byEmail.user_id) !== String(userId)) {
    throw new Error("Access disabled")
  }

  // 5) Attach user_id if needed (race-safe)
  const attached = await attachProfileToUser(byEmail.id, userId)

  // If attach did nothing (already attached by another request), refetch by user_id
  const finalRow = attached ?? (await fetchProfileByUserId(userId)) ?? byEmail

  const profileText =
    (finalRow.profile_text && String(finalRow.profile_text).trim()) ||
    buildProfileTextFromRow(finalRow, email)

  if (!finalRow.profile_text && profileText) {
    await persistProfileText(finalRow.id, profileText)
  }

  return { userId, email, profileText }
}






