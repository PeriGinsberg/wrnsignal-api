// app/api/coach/job-queue/proposals/route.ts
//
// GET    pending criteria proposals for the coach's clients, with the
//        decisions behind each and the client's current value of the field.
// PATCH  { id, decision: 'approve' | 'reject' }. Approve writes
//        client_match_criteria (lib/match/weekly.ts applyProposal); that
//        night's matching re-judges the client.
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { assertFullAccess, coachClients, HttpError } from "@/lib/match/jobQueue"
import { applyProposal } from "@/lib/match/weekly"
import { coachCaller, fail } from "../_shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const ids = (await coachClients(sb, coachProfileId)).filter((c) => c.accessLevel === "full").map((c) => c.clientProfileId)
    if (!ids.length) return withCorsJson(req, { ok: true, proposals: [] })
    const { data: ps, error } = await sb.from("criteria_proposals").select("*, client_profiles(name)")
      .in("client_profile_id", ids).eq("status", "pending").order("week_of", { ascending: false }).order("created_at")
    if (error) throw new Error(error.message)
    const matchIds = [...new Set((ps ?? []).flatMap((p: any) => p.evidence_match_ids ?? []))]
    const evidence = new Map<string, any>()
    for (let i = 0; i < matchIds.length; i += 200) {
      const { data } = await sb.from("posting_matches").select("id, action, dismiss_reason, note, score, postings(title, cleaned_title, company)").in("id", matchIds.slice(i, i + 200))
      for (const m of data ?? []) evidence.set(m.id, m)
    }
    const { data: crits } = await sb.from("client_match_criteria").select("*").in("client_profile_id", [...new Set((ps ?? []).map((p: any) => p.client_profile_id))])
    const critBy = new Map((crits ?? []).map((c: any) => [c.client_profile_id, c]))
    return withCorsJson(req, {
      ok: true,
      proposals: (ps ?? []).map((p: any) => {
        const c: any = critBy.get(p.client_profile_id) ?? {}
        return {
          id: p.id, client_profile_id: p.client_profile_id, client: p.client_profiles?.name ?? "", week_of: p.week_of,
          field: p.field, op: p.op, value: p.value, rationale: p.rationale,
          current: p.field === "salary_floor" ? (c.salary_floor ? `${c.salary_floor} per ${c.salary_floor_period}` : null) : c[p.field] ?? null,
          evidence: (p.evidence_match_ids ?? []).map((id: string) => evidence.get(id)).filter(Boolean).map((m: any) => ({
            title: m.postings?.cleaned_title ?? m.postings?.title, company: m.postings?.company, action: m.action, reason: m.dismiss_reason, note: m.note, score: m.score,
          })),
        }
      }),
    })
  } catch (err) {
    return fail(req, err)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { sb, coachProfileId } = await coachCaller(req)
    const b = await req.json().catch(() => null)
    if (!b?.id || !["approve", "reject"].includes(b.decision)) throw new HttpError(400, "id and decision (approve | reject) are required")
    const { data: p, error } = await sb.from("criteria_proposals").select("*").eq("id", b.id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!p) throw new HttpError(404, "proposal not found")
    if (p.status !== "pending") throw new HttpError(409, `already ${p.status}`)
    await assertFullAccess(sb, coachProfileId, p.client_profile_id)
    const applied = b.decision === "approve" ? await applyProposal(sb, p) : null
    const { error: uErr } = await sb.from("criteria_proposals").update({
      status: b.decision === "approve" ? "approved" : "rejected", decided_at: new Date().toISOString(), decided_by: coachProfileId,
    }).eq("id", p.id).eq("status", "pending")
    if (uErr) throw new Error(uErr.message)
    return withCorsJson(req, { ok: true, applied })
  } catch (err) {
    return fail(req, err)
  }
}
