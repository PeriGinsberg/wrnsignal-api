// lib/collab/identity.ts
//
// Shared "who is calling" chain for coach-collaboration routes.
//
// Lifted VERBATIM from the inline copies duplicated across the coach API
// routes (e.g. app/api/coach/client-runs/[client_profile_id]/route.ts and
// app/api/coach/recommend-job/route.ts, which were byte-identical). This is a
// pure centralization refactor — the queries, error messages, ordering, and
// the profile email-attach side effect are unchanged.
//
// Resolution: Bearer JWT -> auth.users.id -> client_profiles row.
// resolveCaller() returns { profileId, isCoach }.
//
// Note on placement: the `is_coach` read (formerly the inline `verifyCoach`)
// lives here rather than in access.ts, because identity's contract must return
// `isCoach` and duplicating the query across both modules is the only
// alternative. access.ts owns the coach_clients relationship + level check.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

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

export async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
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
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
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
