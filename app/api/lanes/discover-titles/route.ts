// app/api/lanes/discover-titles/route.ts
// GET ?lane_id=<uuid>&phrase=<rough phrase>
//
// Ask the board what a rough phrase is actually TITLED, so a lane's titles come
// from the vocabulary employers post under rather than the vocabulary the
// client speaks. "front office" is what baseball people say; the board titles
// that work "Baseball Operations Assistant" and "Area Scout", and a lane built
// on the spoken phrase finds nothing at all.
//
// The search is run with the LANE's own keyword and location, not neutral
// defaults. A discovery result found under different search conditions than the
// lane uses would list titles the lane can never surface — the whole point is
// that what you see here is what the lane will find.
//
// Counts are the number of postings in this sample carrying each core_job_title,
// so they rank titles against each other. They are not a promise of yield: the
// lane's years_max and exclusions still apply on a real run, and the sample is
// one page.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"
import { SENIORITY_LEVELS, fetchJobs, queryFor } from "@/lib/hiringcafe"
import { toSearchFilters } from "@/lib/laneRunner"
import { LEGACY_POSTING_WINDOW_DAYS } from "@/lib/lanePostingWindow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Same seniority band the runner uses, for the same reason the keyword,
// location and posting window all come from the lane: a discovery result found
// under different search conditions lists titles the lane can never surface.
const SENIORITY = [...SENIORITY_LEVELS].slice(0, 3) // through Mid Level

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const url = new URL(req.url)
    const laneId = url.searchParams.get("lane_id")
    const phrase = (url.searchParams.get("phrase") || "").trim()

    if (!laneId) return withCorsJson(req, { ok: false, error: "lane_id required" }, 400)
    if (!phrase) return withCorsJson(req, { ok: false, error: "phrase required" }, 400)

    const supabase = getSupabaseAdmin()
    // read: discovery only searches the board. It shows what a lane COULD find
    // without changing what it will find, so it sits at the same level as
    // viewing the lane rather than at configure.
    const { lane, error: accessErr } = await loadAuthorizedLane(
      laneId,
      profileId,
      "read",
      supabase,
      "id, client_profile_id, titles, keyword, location, days_posted, filters"
    )
    if (accessErr) return withCorsJson(req, { ok: false, error: accessErr }, accessErr === "Forbidden" ? 403 : 404)

    // Three location states, as in the runner: a preset, an explicit null for
    // no geographic filter, and an absent key — which is a lane nobody scoped
    // and must not be guessed at in either direction.
    const location = (lane as any).location || {}
    const presets: string[] = Array.isArray(location.presets)
      ? location.presets
      : "preset" in location
        ? location.preset == null
          ? []
          : [location.preset]
        : (null as any)
    if (presets === null) {
      return withCorsJson(
        req,
        { ok: false, error: 'lane has no location.presets — set markets, or [] for no geographic filter' },
        400
      )
    }
    const radiusMiles: number = location.radius_miles ?? 25
    const keyword: string | null = (lane as any).keyword ?? null
    // The lane's own window. A lane looking back 24 hours must not be offered
    // titles that only exist in a month of backlog.
    const days: number = (lane as any).days_posted ?? LEGACY_POSTING_WINDOW_DAYS

    const query = queryFor(phrase, keyword)
    const { rows, total } = await fetchJobs({
      query,
      locations: presets,
      radiusMiles,
      days,
      seniority: SENIORITY,
      pages: 1,
      // The lane's own board filters, so discovery lists titles this lane can
      // actually surface rather than titles it would have found without them.
      ...toSearchFilters((lane as any).filters),
    })

    // Group on core_job_title — the board's own normalisation. Grouping on the
    // raw posting title instead would return "BASEBALL COACH | NORTH FORSYTH
    // HIGH SCHOOL" as its own distinct title and never aggregate anything.
    const counts = new Map<string, number>()
    let untitled = 0
    for (const r of rows) {
      const t = (r.normalized_title || "").trim()
      if (!t) {
        untitled++
        continue
      }
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }

    const existing = new Set(((lane as any).titles || []).map((t: string) => String(t).toLowerCase()))
    const titles = [...counts.entries()]
      .map(([title, count]) => ({ title, count, already: existing.has(title.toLowerCase()) }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))

    return withCorsJson(
      req,
      {
        ok: true,
        query,
        keyword,
        location: presets.length ? { presets, radius_miles: radiusMiles } : null,
        days,
        // fetched vs available: one page of a larger set is a sample, and a
        // count presented without that distinction reads as the whole board.
        fetched: rows.length,
        available: total,
        capped: total > rows.length,
        untitled,
        titles,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
