// app/api/coach/tasks/assignees/route.ts
//
// Who a task may be assigned to: every coach profile.
//
// A separate endpoint rather than a field on the task list, because the
// assignee dropdown has to offer coaches who currently own no tasks at all.
// Deriving the options from the tasks already in the list would mean a new
// coach could never be given their first one.
//
// NARROWED TO ONE CLIENT when the screen names one (?client_profile_id= or
// ?coach_client_id=): only coaches who can open that client, because a task
// handed to anyone else is refused on save (lib/tasks/service.ts). With no
// client the full list is returned, since the task list also uses it to put
// names to assignees and a task with no client can go to any coach.
//
// INACTIVE COACHES ARE INCLUDED, and flagged. People go on holiday and leave;
// hiding them would make it impossible to see, or to reassign, the work already
// sitting with them. The UI marks them rather than dropping them.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"
import { coachesWhoCanReach } from "@/lib/tasks/scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const db = getSupabaseAdmin()
    const q = new URL(req.url).searchParams
    const allowed = await coachesWhoCanReach(db, {
      client_profile_id: q.get("client_profile_id"),
      coach_client_id: q.get("coach_client_id"),
    })

    if (allowed && !allowed.size) {
      return withCorsJson(req, { ok: true, me: coachProfileId, assignees: [] }, 200)
    }

    let sel = db
      .from("client_profiles")
      .select("id, name, email, active")
      .eq("is_coach", true)
      .order("name", { ascending: true })
    if (allowed) sel = sel.in("id", [...allowed])
    const { data, error: qErr } = await sel

    if (qErr) return withCorsJson(req, { ok: false, error: qErr.message }, 500)

    return withCorsJson(req, {
      ok: true,
      me: coachProfileId,
      assignees: (data ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.email ?? "Unnamed coach",
        email: c.email,
        active: c.active !== false,
      })),
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/tasks/assignees]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
