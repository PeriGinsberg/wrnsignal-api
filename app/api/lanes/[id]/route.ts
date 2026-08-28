// app/api/lanes/[id]/route.ts
// GET   — one lane's full config, for the edit screen.
// PATCH { titles?, active?, filters?, years_max?, days_posted? } — replace any
//         combination of them.
//
// SCOPE. Keyword, location, companies and exclusions are shown on the edit
// screen but still not writable here: each has a failure mode that needs its
// own guard (a bad location preset returns a fake zero-result, a keyword can
// silently empty the lane), and a route that accepted them would have to grow
// those guards before it was safe.
//
// years_max and days_posted ARE writable, because the guard each one needs is
// a range check the route can do in full. Neither can put the lane into a state
// the runner cannot describe: years_max is a ceiling that only bites on
// postings that stated a minimum, and days_posted is one of five values the
// column itself enforces. Both narrow or widen the queue visibly, in the
// direction the coach chose, which is the opposite of the silent failures
// above.
//
// `active` is safe in a way those are not: it is a boolean with no bad value,
// and setting it false only stops the nightly sweep picking the lane up (the
// sweep selects active = true). Results and run history are untouched — pausing
// is not deleting, which is why lanes are paused rather than deleted in the
// first place (20260817_search_lanes.sql).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { loadAuthorizedLane } from "@/lib/collab/laneAccess"
import { toBoardCommitment } from "@/lib/laneCommitment"
import { POSTING_WINDOW_DAYS } from "@/lib/lanePostingWindow"
import { invalidSeniority, orderSeniority } from "@/lib/laneSeniority"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LANE_FIELDS =
  "id, client_profile_id, name, active, titles, keyword, location, days_posted, seniority, years_max, companies, exclusions, filters"

// Every title is one board fetch on every run, so the list is a cost, not just
// a preference. The limit is generous enough that nobody hits it by accident
// and low enough that a runaway edit screen cannot turn one run into fifty
// requests.
const MAX_TITLES = 12

/** Same normalisation the lane runner effectively relies on: lowercase, single-spaced. */
const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()
    // read, not configure: seeing a lane's config is what the edit screen and
    // the client-record tab both need before they can show anything.
    const { lane, error } = await loadAuthorizedLane(id, profileId, "read", supabase, LANE_FIELDS)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    // What deleting this lane would destroy, and what clearing its queue would
    // cost. Returned with the config so both confirmations can name the number
    // instead of asking "are you sure".
    const [{ count: results }, { count: unreviewed }, { count: runs }] = await Promise.all([
      supabase.from("lane_results").select("id", { count: "exact", head: true }).eq("lane_id", id),
      supabase
        .from("lane_results")
        .select("id", { count: "exact", head: true })
        .eq("lane_id", id)
        .is("action", null),
      supabase.from("lane_runs").select("id", { count: "exact", head: true }).eq("lane_id", id),
    ])

    return withCorsJson(
      req,
      { ok: true, lane, counts: { results: results ?? 0, unreviewed: unreviewed ?? 0, runs: runs ?? 0 } },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    // Each field is optional, but sending neither is a caller bug worth naming
    // rather than a silent no-op write.
    const wantsTitles = body?.titles !== undefined
    const wantsActive = body?.active !== undefined
    const wantsFilters = body?.filters !== undefined
    const wantsYearsMax = body?.years_max !== undefined
    const wantsDaysPosted = body?.days_posted !== undefined
    const wantsSeniority = body?.seniority !== undefined
    if (!wantsTitles && !wantsActive && !wantsFilters && !wantsYearsMax && !wantsDaysPosted && !wantsSeniority) {
      return withCorsJson(
        req,
        {
          ok: false,
          error:
            "nothing to update — send titles, active, filters, years_max, days_posted, seniority, or any combination",
        },
        400
      )
    }

    const update: {
      titles?: string[]
      active?: boolean
      filters?: Record<string, string[]>
      years_max?: number | null
      days_posted?: number
      seniority?: string[]
    } = {}

    if (wantsFilters) {
      // Whole-object replace, not a merge: a coach clearing every industry must
      // be able to, and a merge makes removal impossible to express.
      const raw = body.filters
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return withCorsJson(req, { ok: false, error: "filters must be an object" }, 400)
      }
      const FILTER_KEYS = ["industries", "excluded_industries", "company_keywords", "excluded_company_keywords", "commitment_types"] as const
      const filters: Record<string, string[]> = {}
      for (const key of FILTER_KEYS) {
        const v = (raw as any)[key]
        if (v === undefined || v === null) continue
        if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === "string")) {
          return withCorsJson(req, { ok: false, error: `filters.${key} must be an array of strings` }, 400)
        }
        let cleaned = v.map((x: string) => x.trim()).filter(Boolean)
        // See the POST handler: an unrecognised commitment type empties the
        // lane rather than being ignored, so it is refused here.
        if (key === "commitment_types") {
          const bad = cleaned.filter((x) => !toBoardCommitment(x))
          if (bad.length) {
            return withCorsJson(
              req,
              { ok: false, error: `unknown commitment type(s): ${bad.join(", ")}. Use one of Full Time, Part Time, Internship, Contract, Temporary, Seasonal, Volunteer.` },
              400
            )
          }
          cleaned = cleaned.map((x) => toBoardCommitment(x)!)
        }
        if (cleaned.length) filters[key] = cleaned
      }
      update.filters = filters
    }

    if (wantsActive) {
      if (typeof body.active !== "boolean") {
        return withCorsJson(req, { ok: false, error: "active must be true or false" }, 400)
      }
      update.active = body.active
    }

    if (wantsYearsMax) {
      // null is a real value here, not a missing one: it means "no ceiling",
      // which is the only way to remove a ceiling a lane already has.
      if (body.years_max === null) {
        update.years_max = null
      } else {
        const n = Number(body.years_max)
        // Integer, not merely finite. The column is an integer, so 2.5 would be
        // rejected by Postgres after the request looked accepted, and a ceiling
        // of "two and a half years" is not a thing a posting can state anyway.
        if (!Number.isInteger(n) || n < 0) {
          return withCorsJson(req, { ok: false, error: "years_max must be a whole number of years, 0 or more, or null for no ceiling" }, 400)
        }
        update.years_max = n
      }
    }

    if (wantsDaysPosted) {
      const n = Number(body.days_posted)
      // Closed set, checked here so the caller gets the vocabulary back rather
      // than a constraint-violation 500 from the database.
      if (!POSTING_WINDOW_DAYS.has(n)) {
        return withCorsJson(
          req,
          { ok: false, error: `days_posted must be one of ${[...POSTING_WINDOW_DAYS].join(", ")}` },
          400
        )
      }
      update.days_posted = n
    }

    if (wantsSeniority) {
      // One validator, shared with the create path and phrased as the message
      // the caller sees. An empty band is refused rather than read as "no
      // restriction": see lib/laneSeniority.ts.
      const bad = invalidSeniority(body.seniority)
      if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
      // Stored in board order so the chips never reshuffle between saves.
      update.seniority = orderSeniority(body.seniority as string[])
    }

    if (wantsTitles) {
      if (!Array.isArray(body.titles)) {
        return withCorsJson(req, { ok: false, error: "titles must be an array" }, 400)
      }
      if (!body.titles.every((t: unknown) => typeof t === "string")) {
        return withCorsJson(req, { ok: false, error: "titles must all be strings" }, 400)
      }

      // Normalise and dedupe server-side rather than trusting the screen: two
      // titles differing only by case would be two board fetches returning the
      // same jobs, and the runner folds them into one result anyway.
      const seen = new Set<string>()
      const titles: string[] = []
      for (const raw of body.titles as string[]) {
        const t = normTitle(raw)
        if (!t || seen.has(t)) continue
        seen.add(t)
        titles.push(t)
      }

      if (!titles.length) {
        // A lane with no titles fetches nothing and looks, in the review queue,
        // exactly like a lane that found nothing.
        return withCorsJson(req, { ok: false, error: "a lane needs at least one title" }, 400)
      }
      if (titles.length > MAX_TITLES) {
        return withCorsJson(req, { ok: false, error: `at most ${MAX_TITLES} titles (got ${titles.length})` }, 400)
      }
      update.titles = titles
    }

    const supabase = getSupabaseAdmin()
    // configure: titles decide what this lane will ever find, so a view-only or
    // annotate-only coach must not reach this.
    const { error } = await loadAuthorizedLane(id, profileId, "configure", supabase, LANE_FIELDS)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)
    const { data, error: upErr } = await supabase
      .from("search_lanes")
      .update(update)
      .eq("id", id)
      .select(LANE_FIELDS)
      .single()
    if (upErr) throw new Error(`Update failed: ${upErr.message}`)

    return withCorsJson(req, { ok: true, lane: data }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove the lane, its results and its run history
// ---------------------------------------------------------------------------
// The original schema said lanes are paused, not deleted, precisely because a
// lane carries the record of what it already found. That still holds for a lane
// a client might come back to — pause is the reversible answer and it is one
// click away on the same screen.
//
// This is for the other case: a lane created by mistake, or for a search that
// was never theirs. Both lane_results and lane_runs are ON DELETE CASCADE, so
// the row going takes its results and history with it. There is no undo, which
// is why the counts are returned before the fact by GET and reported again here.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { lane, error } = await loadAuthorizedLane(id, profileId, "configure", supabase, LANE_FIELDS)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)

    // Counted BEFORE the delete: afterwards the rows are gone and the answer
    // would always be zero, which tells the caller nothing about what it cost.
    const [{ count: results }, { count: runs }] = await Promise.all([
      supabase.from("lane_results").select("id", { count: "exact", head: true }).eq("lane_id", id),
      supabase.from("lane_runs").select("id", { count: "exact", head: true }).eq("lane_id", id),
    ])

    const { error: delErr } = await supabase.from("search_lanes").delete().eq("id", id)
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`)

    return withCorsJson(
      req,
      {
        ok: true,
        deleted: {
          lane: { id, name: (lane as any).name },
          results: results ?? 0,
          runs: runs ?? 0,
        },
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const s = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, s)
  }
}
