// app/api/lanes/[id]/queue/route.ts
// GET    — what clearing would cost, without writing anything.
// DELETE ?scope=all|mismatched — empty the review queue, or only the part of it
//          the lane's current criteria would no longer return.
//
// A lane left alone for a month greets its coach with a hundred unreviewed
// rows, most of them roles filled by now. Before this, the only ways out were
// judging every row one at a time or deleting the lane, and deleting the lane
// throws away the review history, which is the part worth keeping.
//
// WHAT IT WRITES, and why it is not a delete. Unreviewed rows are marked
// action = 'cleared' rather than removed. The runner upserts on
// (lane_id, job_id), so a deleted row is re-inserted by the next run with a
// fresh first_seen_at and lands straight back in the queue: a clear that
// deletes would appear to work until the next morning. The kept row is
// refreshed in place instead, and stays out of the queue because it has an
// action. Being marked rather than deleted is also what makes any slice of it
// reversible afterwards. See 20260827_lane_result_cleared.sql.
//
// WHAT IT LEAVES ALONE. Everything already actioned. Both scopes filter on
// action IS NULL, so pushes and dismissals keep their reason, note and
// actioned_at exactly as the reviewer left them. That filter is also what makes
// running this twice a no-op rather than a rewrite of the review history.
//
// ---------------------------------------------------------------------------
// scope=mismatched
// ---------------------------------------------------------------------------
// Narrowing a lane does nothing to what is already queued: years_max, the
// window, the seniority band and the filters are all applied as a run WRITES
// rows. So a coach who tightens a lane still faces the queue the old criteria
// produced, and the only tool was clearing all of it including the jobs that
// were correctly targeted. This scope clears the difference instead.
//
// THE PREDICATE IS NOT REIMPLEMENTED. Everything the runner applies after the
// fetch comes from applyLaneFilters(), called here on the stored rows, so the
// verdict is by construction the same one a run would reach: companies
// allowlist, excluded companies, excluded title keywords, years_max against a
// STATED minimum, and expired. lane_results stores every field it reads.
//
// Two criteria are query-side rather than post-fetch, so they have no
// applyLaneFilters equivalent and are checked here: the seniority band and the
// posting window. Both compare against a stored column, so both are exact.
//
// WHAT IS DELIBERATELY NOT CHECKED: industries, excluded industries, company
// keywords and excluded company keywords. Those are evaluated by the board,
// which matches a single term as a prefix of any word in a label and a
// multi-word term as a whole label (see SearchOpts in lib/hiringcafe.ts).
// Approximating that against the stored company_industries would clear rows the
// lane would in fact still return, and a wrong clear is invisible: the job just
// never appears again. Reporting them as unchecked beats guessing.
//
// MISSING DATA IS KEPT. A row that never stated its band, its posting date or
// its minimum years is left in the queue. Unknown is not the same as failing,
// and the failure direction that costs you a job is worse than the one that
// costs you a row to skim.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"
import { applyLaneFilters, type Lane } from "@/lib/laneRunner"
import { LEGACY_POSTING_WINDOW, postingWindowApproxDays, postingWindowLabel } from "@/lib/lanePostingWindow"
import { DEFAULT_SENIORITY_BANDS } from "@/lib/laneSeniority"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Columns the evaluation needs: applyLaneFilters' inputs, plus the two query-side ones. */
const EVAL_FIELDS = "id, title, company, seniority, posted_at, min_yoe, is_expired"

/**
 * Ids per update statement.
 *
 * `.in()` goes into the query string, so a lane with thousands of stale rows
 * would build a URL long enough to be rejected by something in the middle. The
 * chunk size is well under any such limit and costs one extra round trip per
 * two hundred rows, which is nothing next to being mysteriously truncated.
 */
const CHUNK = 200

/** The board-side filters this cannot evaluate. Reported so the UI can say so. */
const UNCHECKED = ["industries", "excluded_industries", "company_keywords", "excluded_company_keywords"] as const

type EvalRow = {
  id: string
  title: string | null
  company: string | null
  seniority: string | null
  posted_at: string | null
  min_yoe: number | null
  is_expired: boolean | null
}

/**
 * Split the unreviewed queue into what the lane's current criteria would still
 * return and what they would not, with a reason for each row that would go.
 *
 * Shared by GET and DELETE so the number shown in a confirmation is produced by
 * the same code that acts on it. Two implementations of "which rows go" is how
 * a preview comes to disagree with the thing it was previewing.
 */
function splitQueue(rows: EvalRow[], lane: Lane) {
  const bands = lane.seniority?.length ? lane.seniority : [...DEFAULT_SENIORITY_BANDS]
  // days_posted is a board token, not a day count, so the cutoff is derived
  // rather than multiplied. Multiplying it is how a lane set to the board's
  // "1 month" (61) would be cleared against a 61-day cutoff while the board
  // itself only ever returned 59 days of postings.
  const postedWithin = lane.days_posted ?? LEGACY_POSTING_WINDOW
  const cutoff = Date.now() - postingWindowApproxDays(postedWithin) * 86_400_000

  const ids: string[] = []
  const counts: Record<string, number> = {}
  const tally = (reason: string) => {
    counts[reason] = (counts[reason] ?? 0) + 1
  }

  for (const row of rows) {
    let reason: string | null = null

    if (row.seniority && !bands.includes(row.seniority)) {
      reason = `outside the lane's seniority band (${row.seniority})`
    } else if (row.posted_at && new Date(row.posted_at).getTime() < cutoff) {
      reason = `posted outside the lane's window (${postingWindowLabel(postedWithin)})`
    } else {
      // The runner's own post-fetch rules, on the stored row. One row at a
      // time because the reason matters here, and applyLaneFilters reports its
      // reasons as counts rather than per row.
      const { dropped } = applyLaneFilters([row as never], lane)
      const first = Object.keys(dropped)[0]
      if (first) reason = first
    }

    if (reason) {
      ids.push(row.id)
      tally(reason)
    }
  }

  const reasons = Object.entries(counts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))

  return { ids, reasons, mismatched: ids.length, remaining: rows.length - ids.length }
}

/**
 * The whole unreviewed queue, in pages.
 *
 * PostgREST caps a response at its configured maximum, a thousand rows by
 * default, and says nothing when it does. An unpaginated read would silently
 * undercount the preview and under-clear the queue on any lane that had been
 * left alone long enough to need this feature most, and both failures look
 * exactly like the feature working.
 */
async function loadQueue(supabase: ReturnType<typeof getSupabaseAdmin>, laneId: string) {
  const PAGE = 1000
  const rows: EvalRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("lane_results")
      .select(EVAL_FIELDS)
      .eq("lane_id", laneId)
      .is("action", null)
      // Ordered so the pages partition the set. Without a stable sort the
      // server is free to return the same row twice across two ranges and skip
      // another, which is the subtlest way to under-clear.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Queue read failed: ${error.message}`)
    const page = (data ?? []) as unknown as EvalRow[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ---------------------------------------------------------------------------
// GET — the preview
// ---------------------------------------------------------------------------
// Read-only, so a confirmation can name what it is about to do. 'read' rather
// than 'configure': looking at what a clear would cost is not clearing.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { lane, error } = await loadAuthorizedLane(id, profileId, "read", supabase)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    const rows = await loadQueue(supabase, id)
    const { reasons, mismatched, remaining } = splitQueue(rows, lane as Lane)

    return withCorsJson(
      req,
      {
        ok: true,
        unreviewed: rows.length,
        mismatched,
        remaining,
        reasons,
        criteria: {
          seniority: (lane as Lane).seniority ?? [...DEFAULT_SENIORITY_BANDS],
          days_posted: (lane as Lane).days_posted ?? LEGACY_POSTING_WINDOW,
          years_max: (lane as Lane).years_max,
        },
        unchecked: UNCHECKED,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}

// ---------------------------------------------------------------------------
// DELETE — the clear
// ---------------------------------------------------------------------------
// ACCESS. 'configure', the same level as editing titles or deleting the lane,
// not the 'review' level a per-row decision needs. Clearing is a lane-wide act
// that empties the queue for everyone who works it, and it is not a judgement
// about any job in it.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const scope = new URL(req.url).searchParams.get("scope") ?? "all"
    // Named rather than boolean, and validated, so a typo in a query string
    // cannot quietly widen a clear from part of the queue to all of it.
    if (scope !== "all" && scope !== "mismatched") {
      return withCorsJson(req, { ok: false, error: 'scope must be "all" or "mismatched"' }, 400)
    }

    const supabase = getSupabaseAdmin()
    const { lane, error } = await loadAuthorizedLane(id, profileId, "configure", supabase)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    const clearedAt = new Date().toISOString()
    const mark = { action: "cleared", actioned_at: clearedAt }

    if (scope === "all") {
      const { data, error: upErr } = await supabase
        .from("lane_results")
        .update(mark)
        .eq("lane_id", id)
        // The guard on the review history. Without it this rewrites every
        // dismissal on the lane into a clear.
        .is("action", null)
        .select("id")
      if (upErr) throw new Error(`Clear failed: ${upErr.message}`)
      return withCorsJson(
        req,
        { ok: true, scope, lane: { id, name: (lane as Lane).name }, cleared: data?.length ?? 0, cleared_at: clearedAt },
        200
      )
    }

    const rows = await loadQueue(supabase, id)
    const { ids, reasons } = splitQueue(rows, lane as Lane)
    if (!ids.length) {
      return withCorsJson(
        req,
        { ok: true, scope, lane: { id, name: (lane as Lane).name }, cleared: 0, reasons: [], cleared_at: clearedAt },
        200
      )
    }

    let cleared = 0
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error: upErr } = await supabase
        .from("lane_results")
        .update(mark)
        .in("id", ids.slice(i, i + CHUNK))
        // Belt and braces. The ids came from an action IS NULL read, but a
        // concurrent reviewer could have judged one in between, and their
        // decision must win over a bulk clear.
        .is("action", null)
        .select("id")
      if (upErr) throw new Error(`Clear failed: ${upErr.message}`)
      cleared += data?.length ?? 0
    }

    return withCorsJson(
      req,
      {
        ok: true,
        scope,
        lane: { id, name: (lane as Lane).name },
        cleared,
        reasons,
        // Returned so an undo can pin the exact moment rather than a rolling
        // interval, which moves under you while you decide.
        cleared_at: clearedAt,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}
