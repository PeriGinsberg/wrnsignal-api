// app/api/_lib/coachAuth.ts
//
// Shared coach-route auth / scoping — the neutral home for the helpers that
// previously lived in coachPackages.ts (and were duplicated as a private admin
// getter in coachClientEvents.ts). Pure auth: bearer → authed user → coach
// profile → is_coach → resolve coach_profile_id. No feature-specific logic.
//
// Imports ./cors (withCorsJson, used by resolveCoach), supabase-js, and the
// shared caller lookup in lib/collab.
// coachPackages / coachActivities / coachEngagements / coachClientEvents consume
// these from here (some via re-export so route imports stay unchanged).

import { createClient } from "@supabase/supabase-js"
import { withCorsJson } from "./cors"
import { resolveDelegation, type Delegation } from "@/lib/collab/delegation"
import { getCallerProfileOrNull } from "@/lib/collab/identity"
import { ForbiddenError } from "@/lib/collab/errors"

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Who is calling comes from the ONE shared lookup (lib/collab/identity.ts),
// which never hands a caller a profile another live login owns. This file used
// to carry its own copy that re-pointed such a profile at the caller.
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
  // A conflict (a login whose email is on a profile another live login owns)
  // comes back as a 403 Response, the shape every caller already returns
  // as-is. "Unauthorized" still throws, exactly as before.
  let coach: { id: string; is_coach?: boolean } | null
  try {
    coach = await getCallerProfileOrNull<{ name: string | null; is_coach: boolean; coach_org: string | null }>(
      req,
      "id, name, is_coach, coach_org",
    )
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: withCorsJson(req, { ok: false, error: e.message }, 403) }
    throw e
  }
  if (!coach) return { error: withCorsJson(req, { ok: false, error: "Profile not found" }, 404) }
  if (!coach.is_coach) return { error: withCorsJson(req, { ok: false, error: "Forbidden: coach access required" }, 403) }
  const delegation = await resolveDelegation(getSupabaseAdmin(), coach.id as string)
  return { coachProfileId: coach.id as string, delegation }
}

// 401 for auth failures, 403 for a refused caller, 500 otherwise.
export function errStatus(e: any): number {
  if (e instanceof ForbiddenError) return 403
  const msg = e?.message || String(e)
  if (/unauthorized/i.test(msg)) return 401
  if (/forbidden/i.test(msg)) return 403
  return 500
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
