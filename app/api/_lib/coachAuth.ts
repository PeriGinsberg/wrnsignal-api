// app/api/_lib/coachAuth.ts
//
// Shared coach-route auth / scoping — the neutral home for the helpers that
// previously lived in coachPackages.ts (and were duplicated as a private admin
// getter in coachClientEvents.ts). Pure auth: bearer → authed user → coach
// profile → is_coach → resolve coach_profile_id. No feature-specific logic.
//
// Imports only ./cors (withCorsJson, used by resolveCoach) and supabase-js.
// coachPackages / coachActivities / coachEngagements / coachClientEvents consume
// these from here (some via re-export so route imports stay unchanged).

import { createClient } from "@supabase/supabase-js"
import { withCorsJson } from "./cors"
import { resolveDelegation, type Delegation } from "@/lib/collab/delegation"

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfile(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, name, is_coach, coach_org")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, name, is_coach, coach_org, user_id")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
      }
      const { user_id: _u, ...rest } = byEmail as any
      return rest
    }
  }
  return null
}

// Resolve { coachProfileId, delegation } or return an error Response (401/403/404).
//
// `delegation.actingIds` is coachProfileId plus every principal this coach is an
// active delegate of: what an access check should match against. A route that
// still compares against coachProfileId alone keeps its old behaviour, which is
// the safe direction — a delegate is refused until the route is converted.
// coachProfileId remains WHO IS ACTING, and is what every write must stamp.
export async function resolveCoach(
  req: Request,
): Promise<
  | { coachProfileId: string; delegation: Delegation; error?: undefined }
  | { coachProfileId?: undefined; delegation?: undefined; error: Response }
> {
  const { userId, email } = await getAuthedUser(req)
  const coach = await getCoachProfile(userId, email)
  if (!coach) return { error: withCorsJson(req, { ok: false, error: "Profile not found" }, 404) }
  if (!coach.is_coach) return { error: withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403) }
  const delegation = await resolveDelegation(getSupabaseAdmin(), coach.id as string)
  return { coachProfileId: coach.id as string, delegation }
}

// 401 for auth failures (thrown by the helpers above), 500 otherwise.
export function errStatus(e: any): number {
  return /unauthorized/i.test(e?.message || String(e)) ? 401 : 500
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
