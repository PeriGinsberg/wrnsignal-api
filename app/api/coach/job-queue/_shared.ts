// Shared by the Job Queue routes: the caller must be a coach.
import { getAuthedUser, getProfileId, getSupabaseAdmin } from "@/lib/collab/identity"
import { assertCoach, HttpError } from "@/lib/match/jobQueue"
import { errorStatus } from "@/app/api/_lib/routeError"
import { withCorsJson } from "@/app/api/_lib/cors"

export async function coachCaller(req: Request) {
  const { userId, email } = await getAuthedUser(req)
  const coachProfileId = await getProfileId(userId, email)
  const sb = getSupabaseAdmin()
  await assertCoach(sb, coachProfileId)
  return { sb, coachProfileId }
}

export function fail(req: Request, err: unknown) {
  const status = err instanceof HttpError ? err.status : errorStatus(err)
  const msg = (err as any)?.message || String(err)
  if (status >= 500) console.error("[job-queue]", msg)
  return withCorsJson(req, { ok: false, error: msg }, status)
}
