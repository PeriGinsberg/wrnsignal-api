// lib/collab/identity.ts
//
// Shared "who is calling" chain for coach-collaboration routes.
//
// Lifted VERBATIM from the inline copies duplicated across the coach API
// routes (e.g. the since-deleted app/api/coach/client-runs/[client_profile_id]
// route and app/api/coach/recommend-job/route.ts, which were byte-identical). It
// began as a pure centralization refactor. One behaviour has since changed on
// purpose: the email fall-through only claims an UNOWNED profile and refuses
// one another login owns (see getProfileId). Route files that still carry
// their own copy of this lookup do not have that refusal.
//
// Resolution: Bearer JWT -> auth.users.id -> client_profiles row.
// resolveCaller() returns { profileId, isCoach }.
//
// Note on placement: the `is_coach` read (formerly the inline `verifyCoach`)
// lives here rather than in access.ts, because identity's contract must return
// `isCoach` and duplicating the query across both modules is the only
// alternative. access.ts owns the coach_clients relationship + level check.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { ForbiddenError } from "./errors"

// Service-role client. Constructed per-call, exactly as the inline copies did
// (getAuthedUser / getProfileId each built their own; callers still build one
// for their data queries). persistSession/autoRefreshToken off for server use.
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

export async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

/**
 * Is the login that owns a profile gone? Only a definite "no such login"
 * (404 user_not_found) counts. Anything else, a timeout, an outage, a
 * permissions error, answers false, so a hiccup can never hand a profile over.
 */
async function ownerLoginGone(supabase: SupabaseClient, ownerUserId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(ownerUserId)
  if (data?.user) return false
  const e = error as { status?: number; code?: string } | null
  return !!e && (e.status === 404 || e.code === "user_not_found")
}

/**
 * The caller's profile: by login, then by email.
 *
 * THE EMAIL FALL-THROUGH NEVER TAKES A PROFILE FROM A LIVE LOGIN. A profile
 * whose email matches but which another login owns is refused (ForbiddenError,
 * 403) and nothing is written. Re-pointing it handed one person's profile,
 * runs, tracker and board to whoever signed in with an email that profile
 * still carried, for example after the owner's login email was changed by hand
 * and the profile was not.
 *
 * Two cases may claim it, each conditional on the row still being exactly as
 * read, so two logins racing for one profile cannot both win:
 *   - UNOWNED (user_id null): a coach-created client, or an imported profile,
 *     signing in for the first time.
 *   - OWNED BY A LOGIN THAT NO LONGER EXISTS: someone whose login was deleted
 *     and who signed up again with the same email. client_profiles.user_id has
 *     no foreign key to auth.users, so deleting a login leaves the old id in
 *     place. Only a definite "user not found" counts (see ownerLoginGone).
 *
 * This is the ONE caller lookup. Route files must not carry their own copy;
 * tests/identity/no-private-caller-lookups.test.ts enforces it.
 *
 * supabase: injectable for the tests; defaults to the service-role client.
 */
export async function getProfileId(
  userId: string,
  email: string | null,
  opts: { supabase?: SupabaseClient } = {},
) {
  const supabase = opts.supabase ?? getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      // byEmail.user_id cannot equal userId here: the by-login lookup above
      // would have returned it. So any owner at all is someone else.
      const owner = (byEmail.user_id as string | null) ?? null
      if (owner && !(await ownerLoginGone(supabase, owner))) {
        throw new ForbiddenError("Forbidden: profile email conflict: a profile with this email belongs to a different login")
      }
      const claim = supabase
        .from("client_profiles")
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq("id", byEmail.id)
      const { data: claimed, error: attachErr } = await (owner ? claim.eq("user_id", owner) : claim.is("user_id", null))
        .select("id")
      if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      if (!claimed?.length) {
        throw new ForbiddenError("Forbidden: profile email conflict: this profile was claimed by a different login")
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

/**
 * The caller's profile row, with the columns a route needs: the safe lookup
 * above, then one read by id. For routes that used to select their own columns
 * inside a private lookup (name, is_coach, coach_org, ...).
 *
 * Throws "Unauthorized..." (401), ForbiddenError (403) or "Profile not found"
 * (404), all of which routeError / errorStatus map.
 */
export async function getCallerProfile<T extends Record<string, any> = Record<string, any>>(
  req: Request,
  columns: string,
): Promise<T & { id: string }> {
  const { userId, email } = await getAuthedUser(req)
  const profileId = await getProfileId(userId, email)
  const { data, error } = await getSupabaseAdmin()
    .from("client_profiles")
    .select(columns)
    .eq("id", profileId)
    .single()
  if (error || !data) throw new Error(`Profile lookup failed: ${error?.message ?? "no row"}`)
  return { ...(data as unknown as T), id: profileId }
}

/**
 * The same, but null when the caller simply has no profile, for the coach
 * helpers that answer that case themselves. A CONFLICT IS NEVER NULL: it
 * still throws ForbiddenError, so a refused caller cannot fall through to a
 * route's "no profile" branch.
 */
export async function getCallerProfileOrNull<T extends Record<string, any> = Record<string, any>>(
  req: Request,
  columns: string,
): Promise<(T & { id: string }) | null> {
  try {
    return await getCallerProfile<T>(req, columns)
  } catch (e: any) {
    if (/^Profile not found$/.test(e?.message ?? "")) return null
    throw e
  }
}

// Compose the full caller-resolution chain. Sequence and queries mirror the
// inline route logic exactly: getAuthedUser -> getProfileId -> is_coach read.
// The is_coach select uses .single() and the same `=== true` coercion as the
// former inline verifyCoach.
export async function resolveCaller(
  req: Request,
): Promise<{ profileId: string; isCoach: boolean }> {
  const { userId, email } = await getAuthedUser(req)
  const profileId = await getProfileId(userId, email)
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("is_coach")
    .eq("id", profileId)
    .single()
  return { profileId, isCoach: data?.is_coach === true }
}
