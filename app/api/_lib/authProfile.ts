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
  risk_overrides?: any
}

function isDuplicateConstraint(err: any, constraintName?: string) {
  // Postgres unique_violation = 23505
  const code = err?.code
  const msg = String(err?.message || "")
  const details = String(err?.details || "")
  const hint = String(err?.hint || "")

  const hitConstraint =
    constraintName &&
    (msg.includes(constraintName) ||
      details.includes(constraintName) ||
      hint.includes(constraintName))

  return code === "23505" || hitConstraint
}

/**
 * API owns profile creation + attachment.
 * Client never writes to client_profiles.
 *
 * Goal: ensure there is exactly one profile per user_id (unique),
 * and avoid duplicate email unique constraint failures by:
 * - lookup by user_id
 * - else lookup by email; attach only if user_id is null
 * - else create; if create hits duplicate email, re-fetch by email and attach
 */
export async function getAuthedProfileText(
  req: Request
): Promise<{ profileId: string; profileText: string }> {
  const { userId, email } = await getAuthedUser(req)

  // 1) Prefer lookup by user_id
  const { data: byUserId, error: byUserErr } = await supabaseAdmin
    .from("client_profiles")
    .select("id,user_id,email,profile_text")
    .eq("user_id", userId)
    .maybeSingle<ClientProfileRow>()

  if (byUserErr) throw new Error(`Profile lookup failed: ${byUserErr.message}`)
  if (byUserId?.id) {
    return { profileId: byUserId.id, profileText: byUserId.profile_text || "" }
  }

  // If no email, we cannot attach by email. Create a user-owned row.
  if (!email) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from("client_profiles")
      .insert({
        user_id: userId,
        email: null,
        profile_text: "",
        updated_at: new Date().toISOString(),
      })
      .select("id,user_id,email,profile_text")
      .single<ClientProfileRow>()

    if (createErr || !created) {
      throw new Error(`Profile create failed: ${createErr?.message || "unknown"}`)
    }

    return { profileId: created.id, profileText: created.profile_text || "" }
  }

  // 2) Try lookup by email (intake may have created email-only row)
  const { data: byEmail, error: byEmailErr } = await supabaseAdmin
    .from("client_profiles")
    .select("id,user_id,email,profile_text")
    .eq("email", email)
    .maybeSingle<ClientProfileRow>()

  if (byEmailErr) throw new Error(`Profile lookup by email failed: ${byEmailErr.message}`)

  if (byEmail?.id) {
    // If already attached to THIS user, return
    if (byEmail.user_id === userId) {
      return { profileId: byEmail.id, profileText: byEmail.profile_text || "" }
    }

    // If attached to SOME OTHER user, do NOT attach. This should never happen in a healthy flow.
    if (byEmail.user_id && byEmail.user_id !== userId) {
      throw new Error(
        `Profile email conflict: a profile row for ${email} is already attached to a different user_id.`
      )
    }

    // If unowned, attach it to this user_id (unique user_id is safe here because we already confirmed no row exists for userId)
    const { data: attached, error: attachErr } = await supabaseAdmin
      .from("client_profiles")
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .eq("id", byEmail.id)
      .select("id,user_id,email,profile_text")
      .single<ClientProfileRow>()

    if (attachErr || !attached) {
      // If user_id unique violation happens here, it means a row for this user_id appeared between our checks (race).
      if (isDuplicateConstraint(attachErr, "client_profiles_user_id_key")) {
        const { data: raced, error: racedErr } = await supabaseAdmin
          .from("client_profiles")
          .select("id,user_id,email,profile_text")
          .eq("user_id", userId)
          .maybeSingle<ClientProfileRow>()

        if (racedErr) throw new Error(`Profile lookup failed: ${racedErr.message}`)
        if (raced?.id) return { profileId: raced.id, profileText: raced.profile_text || "" }
      }

      throw new Error(`Profile attach failed: ${attachErr?.message || "unknown"}`)
    }

    return { profileId: attached.id, profileText: attached.profile_text || "" }
  }

  // 3) Create fresh row. If this races with intake insert, email unique may trip.
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

  if (createErr) {
    // If we lost a race on email uniqueness, re-fetch by email and attach if unowned.
    if (isDuplicateConstraint(createErr, "client_profiles_email_key")) {
      const { data: existingByEmail, error: reErr } = await supabaseAdmin
        .from("client_profiles")
        .select("id,user_id,email,profile_text")
        .eq("email", email)
        .maybeSingle<ClientProfileRow>()

      if (reErr) throw new Error(`Profile lookup by email failed: ${reErr.message}`)
      if (!existingByEmail?.id) throw new Error(`Profile create failed: duplicate email, but could not re-fetch.`)

      if (existingByEmail.user_id === userId) {
        return {
          profileId: existingByEmail.id,
          profileText: existingByEmail.profile_text || "",
        }
      }

      if (existingByEmail.user_id && existingByEmail.user_id !== userId) {
        throw new Error(
          `Profile email conflict: a profile row for ${email} is already attached to a different user_id.`
        )
      }

      const { data: attached, error: attachErr } = await supabaseAdmin
        .from("client_profiles")
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq("id", existingByEmail.id)
        .select("id,user_id,email,profile_text")
        .single<ClientProfileRow>()

      if (attachErr || !attached) {
        throw new Error(`Profile attach failed: ${attachErr?.message || "unknown"}`)
      }

      return { profileId: attached.id, profileText: attached.profile_text || "" }
    }

    throw new Error(`Profile create failed: ${createErr.message}`)
  }

  if (!created) throw new Error("Profile create failed: unknown")

  return { profileId: created.id, profileText: created.profile_text || "" }
}
