// app/api/_lib/resumeWorkshopAuth.ts
// The Resume Workshop's access check, shared by its notes routes: the caller
// must be the relationship's coach or that coach's delegate, on an active
// relationship. `me` is who is acting (the delegate, not the principal).

import { withCorsJson } from "./cors"
import { getSupabaseAdmin, isCoachClientOwnedByCoach, resolveCoach } from "./coachEngagements"

export async function authorizeWorkshop(req: Request, coachClientId: string) {
  const { coachProfileId, error } = await resolveCoach(req)
  if (error) return { error }
  const db = getSupabaseAdmin()
  if (!(await isCoachClientOwnedByCoach(db, coachProfileId, coachClientId))) {
    return { error: withCorsJson(req as any, { ok: false, error: "Client not found" }, 404) }
  }
  return { db, me: coachProfileId }
}
