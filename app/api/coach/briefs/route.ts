// app/api/coach/briefs/route.ts
//
// GET  this client's campaign briefs, newest first. The history list.
// POST start a new one, as a draft.
//
// A BRIEF IS ALWAYS SCOPED TO A CLIENT. There is no "all briefs" view and this
// route refuses to guess: a campaign belongs to one person and a list mixing
// them would have no use.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCoach } from "@/app/api/_lib/coachAuth"
import {
  BRIEF_COLUMNS,
  LIST_FIELDS,
  TEXT_FIELDS,
  defaultBriefName,
  toList,
  validateBriefWrite,
} from "@/lib/briefs/model"
import { buildPrefill } from "@/lib/briefs/prefill"
import { resolveDelegation } from "@/lib/collab/delegation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The AI profile read happens inside POST when the caller asks for a prefill,
// and a model call plus the writes around it does not reliably finish in 10s.
export const maxDuration = 60

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

/**
 * The relationship this client is on, for the coach who is asking.
 *
 * SCOPED TO THE ACTING COACH AND THEIR PRINCIPALS, the same check
 * /api/network/plan/run makes. A brief drives that plan, so the two cannot
 * disagree about who may act on a client: a coach who can brief a campaign but
 * not build it would file work nobody can do.
 *
 * limit(1) rather than a bare maybeSingle: a client on two active
 * relationships is not supposed to happen, and PostgREST answers a second row
 * with a 500 rather than a useful message. Taking the first is the right
 * failure here, because the brief lands on a real relationship either way.
 */
async function relationshipFor(
  db: ReturnType<typeof getSupabaseAdmin>,
  clientProfileId: string,
  actorProfileId: string,
) {
  const { actingIds } = await resolveDelegation(db, actorProfileId)
  const { data } = await db.from("coach_clients")
    .select("id, coach_profile_id, client_profile_id")
    .eq("client_profile_id", clientProfileId)
    .in("coach_profile_id", actingIds)
    .eq("status", "active")
    .limit(1).maybeSingle()
  return data
}

export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const clientProfileId = new URL(req.url).searchParams.get("client_profile_id")
    if (!clientProfileId) {
      return withCorsJson(req, { ok: false, error: "client_profile_id is required." }, 400)
    }

    const db = getSupabaseAdmin()
    // Refused rather than answered empty. "No campaigns" and "not your client"
    // are different facts and a coach reading the first when the second is true
    // would start a duplicate campaign.
    if (!(await relationshipFor(db, clientProfileId, coachProfileId))) {
      return withCorsJson(req, { ok: false, error: "That client is not on one of your active coaching relationships." }, 403)
    }

    const { data, error: qErr } = await db.from("networking_campaign_briefs")
      .select(BRIEF_COLUMNS)
      .eq("client_profile_id", clientProfileId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (qErr) return withCorsJson(req, { ok: false, error: qErr.message }, 500)

    const briefs = data ?? []

    // The plan each submitted brief produced, so the history can link to it
    // rather than just saying a campaign happened. One query for all of them.
    const ids = briefs.map((b: any) => b.id)
    const { data: jobs } = ids.length
      ? await db.from("networking_plan_jobs")
          .select("id, brief_id, status, step, shared_at, drive_file_url")
          .in("brief_id", ids)
          .order("created_at", { ascending: false })
      : { data: [] as any[] }

    // The tasks still open on each brief: the history's "where is this up to".
    const { data: openTasks } = ids.length
      ? await db.from("coach_tasks")
          .select("id, title, status, brief_id, assignee_profile_id, due_at")
          .in("brief_id", ids).eq("status", "open").is("deleted_at", null)
      : { data: [] as any[] }

    return withCorsJson(req, {
      ok: true,
      briefs: briefs.map((b: any) => ({
        ...b,
        plan: (jobs ?? []).find((j: any) => j.brief_id === b.id) ?? null,
        open_tasks: (openTasks ?? []).filter((t: any) => t.brief_id === b.id),
      })),
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/briefs GET]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const body = await req.json().catch(() => ({}))
    const clientProfileId = String(body?.client_profile_id ?? "")
    if (!clientProfileId) {
      return withCorsJson(req, { ok: false, error: "client_profile_id is required." }, 400)
    }

    const db = getSupabaseAdmin()
    const rel = await relationshipFor(db, clientProfileId, coachProfileId)
    if (!rel) {
      return withCorsJson(req, { ok: false, error: "That client is not on one of your active coaching relationships." }, 403)
    }

    // PREFILL IS THE DEFAULT, and the AI read with it. A coach who clicks New
    // Campaign wants the form filled in as far as it can be; `prefill: false`
    // exists for a test or a deliberately blank brief.
    const wantPrefill = body?.prefill !== false
    const pre = wantPrefill
      ? await buildPrefill(db, clientProfileId)
      : { values: {}, prefilled_fields: [], suggestions: [], suggestions_error: null }

    const { data: client } = await db.from("client_profiles")
      .select("name").eq("id", clientProfileId).maybeSingle()

    const input: Record<string, any> = {
      name: String(body?.name ?? "").trim() || defaultBriefName(client?.name ?? null),
    }
    for (const f of LIST_FIELDS) {
      input[f] = toList(body?.[f] ?? (pre.values as any)[f] ?? [])
    }
    for (const f of TEXT_FIELDS) {
      const v = body?.[f] ?? (pre.values as any)[f] ?? null
      input[f] = v == null ? null : String(v).trim() || null
    }

    const errors = validateBriefWrite(input)
    if (errors.length) return withCorsJson(req, { ok: false, error: errors[0], errors }, 400)

    const { data, error: insErr } = await db.from("networking_campaign_briefs").insert({
      ...input,
      coach_client_id: rel.id,
      client_profile_id: clientProfileId,
      status: "draft",
      // The suggestions are stored with the brief, not just handed to the
      // screen. A suggestion the coach rejected is worth having when the same
      // extraction looks wrong again, and re-reading the profile later would
      // produce a different answer against a profile that has since changed.
      ai_suggestions: wantPrefill
        ? { suggestions: pre.suggestions, error: pre.suggestions_error, read_at: new Date().toISOString() }
        : null,
      prefilled_fields: pre.prefilled_fields,
      created_by_id: coachProfileId,
    }).select(BRIEF_COLUMNS).single()

    if (insErr) return withCorsJson(req, { ok: false, error: insErr.message }, 500)

    return withCorsJson(req, {
      ok: true,
      brief: data,
      suggestions: pre.suggestions,
      suggestions_error: pre.suggestions_error,
    }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/briefs POST]", err?.stack || msg)
    return withCorsJson(req, { ok: false, error: msg }, 500)
  }
}
