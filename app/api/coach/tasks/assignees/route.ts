// app/api/coach/tasks/assignees/route.ts
//
// Who a task may be assigned to: every coach profile.
//
// A separate endpoint rather than a field on the task list, because the
// assignee dropdown has to offer coaches who currently own no tasks at all.
// Deriving the options from the tasks already in the list would mean a new
// coach could never be given their first one.
//
// INACTIVE COACHES ARE INCLUDED, and flagged. People go on holiday and leave;
// hiding them would make it impossible to see, or to reassign, the work already
// sitting with them. The UI marks them rather than dropping them.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const { data, error: qErr } = await getSupabaseAdmin()
      .from("client_profiles")
      .select("id, name, email, active")
      .eq("is_coach", true)
      .order("name", { ascending: true })

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
