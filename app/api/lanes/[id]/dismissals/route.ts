// app/api/lanes/[id]/dismissals/route.ts
// GET — what this lane's reviewers have decided, and why.
//
// The dismissal taxonomy was built to be counted. lib/laneReasons.ts says so in
// its own header: forty wrong_function dismissals mean the lane's titles are
// wrong, forty wrong_industry mean its keyword or filters are. Until this
// endpoint existed nothing read a reason back, so every one of those judgements
// was written to a column no screen displayed and no query consulted. This is
// the read side that was missing.
//
// WHAT IT DOES NOT DO. It does not change what the lane searches. The nightly
// run builds its query from titles, keyword, location, window, seniority and
// board filters, and filters the results on the companies allowlist, exclusions
// and years_max; it consults no past decision. This endpoint puts the evidence
// in front of a person so THEY can change the lane. Automatic correction is a
// different feature and a much stronger claim.
//
// COUNTED IN JS, NOT SQL. PostgREST has no GROUP BY, and one reason column for
// a lane's dismissals is a few hundred short strings at worst. An RPC would buy
// nothing here and would put the taxonomy in a third place.
//
// KIND COMES FROM lib/laneReasons.ts, never from a list retyped here. A reason
// whose kind this file guessed at would be the drift the shared module exists
// to prevent.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"
import { LANE_REASONS } from "@/lib/laneReasons"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * How many recent notes to return.
 *
 * Bounded because a note is free text and a busy lane accumulates them without
 * limit. The counts are the summary; the notes are the texture behind the
 * biggest ones, and a reviewer reading back through more than this is really
 * asking for an export.
 */
const NOTE_LIMIT = 25

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()

    // read: this reports on decisions already made. Seeing why a lane is being
    // rejected is part of judging the lane, which sits at the same level as
    // viewing it.
    const { error: accessErr } = await loadAuthorizedLane(
      id,
      profileId,
      "read",
      supabase,
      "id, client_profile_id, name"
    )
    if (accessErr) {
      return withCorsJson(req, { ok: false, error: accessErr }, accessErr === "Forbidden" ? 403 : 404)
    }

    // Every actioned row, so the totals reconcile: a reader who sees 40
    // dismissals and no denominator cannot tell a badly aimed lane from a
    // heavily worked one.
    const { data, error } = await supabase
      .from("lane_results")
      .select("action, reason")
      .eq("lane_id", id)
      .not("action", "is", null)
    if (error) throw new Error(`Dismissals failed: ${error.message}`)

    const rows = data ?? []
    const byReason = new Map<string, number>()
    let pushed = 0
    let cleared = 0
    let dismissed = 0
    for (const r of rows) {
      const action = (r as { action: string | null }).action
      if (action === "push") pushed++
      else if (action === "cleared") cleared++
      else if (action === "dismiss") {
        dismissed++
        const reason = (r as { reason: string | null }).reason
        if (reason) byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
      }
    }

    // Ordered by count, and carrying the label and kind from the shared module
    // so a caller never has to map a value to a name. A reason with zero
    // dismissals is omitted: an empty row reads as a signal that is simply
    // small, when in fact nobody has ever filed it.
    const reasons = [...byReason.entries()]
      .map(([value, count]) => {
        const known = LANE_REASONS.find((r) => r.value === value)
        return {
          value,
          count,
          // A stored value with no entry here is a database ahead of the code,
          // which is exactly the case worth showing rather than hiding.
          label: known?.label ?? value,
          kind: known?.kind ?? "unclassified",
        }
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

    // The notes, newest first. Separate query rather than filtering the set
    // above, because that one deliberately selects two columns for counting and
    // this one wants the job it was about.
    const { data: noteRows } = await supabase
      .from("lane_results")
      .select("id, reason, note, actioned_at, title, company")
      .eq("lane_id", id)
      .eq("action", "dismiss")
      .not("note", "is", null)
      .order("actioned_at", { ascending: false })
      .limit(NOTE_LIMIT)

    const notes = (noteRows ?? []).map((n) => {
      const row = n as { id: string; reason: string | null; note: string | null; actioned_at: string | null; title: string | null; company: string | null }
      return {
        id: row.id,
        reason: row.reason,
        label: LANE_REASONS.find((r) => r.value === row.reason)?.label ?? row.reason,
        note: row.note,
        actioned_at: row.actioned_at,
        title: row.title,
        company: row.company,
      }
    })

    return withCorsJson(
      req,
      {
        ok: true,
        totals: { actioned: rows.length, dismissed, pushed, cleared },
        reasons,
        notes,
        note_limit: NOTE_LIMIT,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}
