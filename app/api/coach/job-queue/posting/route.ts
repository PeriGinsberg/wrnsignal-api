// app/api/coach/job-queue/posting/route.ts
//
// GET  ?match_id=  the posting's title, company, link and description text, for
//                  the Source a Job prefill (the coach no longer pastes it).
// POST { posting_ids[], flag?, apply_url? }  flag 'closed' | 'bad_link' |
//                  'not_us' | null, and/or a coach-found apply link ("Save
//                  URL"), for every copy of the job. Applies to every client.
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { postingText } from "@/lib/ingest/enrichPostings"
import { assertFullAccess, assertPostingAccess, HttpError, setPostingFlag } from "@/lib/match/jobQueue"
import { coachCaller, fail } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const matchId = new URL(req.url).searchParams.get("match_id") ?? ""
    if (!matchId) throw new HttpError(400, "match_id is required")
    const { data: m, error } = await sb.from("posting_matches").select("client_profile_id, posting_id, apply_url").eq("id", matchId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!m) throw new HttpError(404, "match not found")
    await assertFullAccess(sb, coachProfileId, m.client_profile_id)
    const [{ data: p, error: pErr }, { data: f }] = await Promise.all([
      sb.from("postings").select("source, title, cleaned_title, company, location, apply_url, requirements_summary, raw").eq("id", m.posting_id).single(),
      sb.from("posting_coach_flags").select("apply_url").eq("posting_id", m.posting_id).maybeSingle(),
    ])
    if (pErr || !p) throw new Error(pErr?.message ?? "posting not found")
    return withCorsJson(req, {
      ok: true, client_profile_id: m.client_profile_id, title: p.cleaned_title ?? p.title, company: p.company, location: p.location,
      apply_url: f?.apply_url ?? m.apply_url ?? p.apply_url, requirements_summary: p.requirements_summary, description: postingText(p.source, p.raw),
    })
  } catch (err) {
    return fail(req, err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const b = await req.json().catch(() => null)
    if (!b || typeof b !== "object") throw new HttpError(400, "Invalid JSON body")
    const ids: string[] = Array.isArray(b.posting_ids) ? [...new Set<string>(b.posting_ids.map(String))] : []
    if (!ids.length || ids.length > 120) throw new HttpError(400, "posting_ids: 1 to 120 ids")
    if (!("flag" in b) && !("apply_url" in b)) throw new HttpError(400, "flag or apply_url is required")
    await assertPostingAccess(sb, coachProfileId, ids)
    const r = await setPostingFlag(sb, {
      postingIds: ids, actorId: coachProfileId,
      ...("flag" in b ? { flag: b.flag ?? null } : {}),
      ...("apply_url" in b ? { applyUrl: b.apply_url ? String(b.apply_url) : null } : {}),
    })
    return withCorsJson(req, { ok: true, ...r })
  } catch (err) {
    return fail(req, err)
  }
}
