// app/api/_lib/meAuth.ts
//
// The plain-CLIENT identity resolver for the /api/me/* routes: bearer token →
// Supabase auth user → this user's client_profiles.id. NOT coachAuth — no
// is_coach, no resolveCoach, no access_level. Callers pair it with
// getActiveCoachRelationship (./coachedClient) when the route is coached-only.
//
// WHY THIS FILE EXISTS. These forty lines were copy-pasted verbatim into
// /api/me/activities, /api/me/activities/[activity_id], /api/me/activity-notes/
// [id]/done and /api/me/documents before this was extracted. Four copies of an
// AUTH path is the shape that produces a fix applied to three of them: the same
// failure the account-creation triplication already caused elsewhere in this
// codebase. New /api/me routes import from here.
//
// The four existing copies are deliberately NOT refactored in the commit that
// adds this — swapping the auth path of four live coached-client routes is its
// own change with its own testing, and bundling it with a new feature is how a
// feature ships an auth regression. They should migrate onto this one by one.
//
// The admin client is built LAZILY, per call, exactly as those four do. It is
// not hoisted to module scope (the way authProfile.ts does it) because a
// top-level requireEnv throws at IMPORT time, which turns a missing env var into
// a route that 500s before its own try/catch can shape the error.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  // "Unauthorized" in the message is load-bearing: the routes map it to 401.
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

// Who is calling: the ONE shared lookup in lib/collab/identity.ts, re-exported
// so /api/me routes keep importing from here. getProfileId finds the profile
// by login, then by email, and never hands a caller a profile another live
// login owns (ForbiddenError, 403). It used to be a private copy that returned
// any email-matched profile without checking whose it was.
export { getAuthedUser, getProfileId } from "@/lib/collab/identity"
