// app/api/lanes/[id]/route.ts
// GET   — one lane's full config, for the edit screen.
// PATCH { titles: string[] } — replace the lane's title list.
//
// SCOPE. PATCH writes titles and active, and nothing else. Keyword, location,
// years_max and exclusions are shown on the edit screen but not writable here:
// each one has a failure mode that needs its own guard (a bad location preset
// returns a fake zero-result, a keyword can silently empty the lane), and a
// route that accepts them all would have to grow those guards before it was
// safe.
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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LANE_FIELDS = "id, client_profile_id, name, active, titles, keyword, location, years_max, companies, exclusions"

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
    // read, not configure: seeing a lane's config is what the edit screen and
    // the client-record tab both need before they can show anything.
    const { lane, error } = await loadAuthorizedLane(id, profileId, "read", getSupabaseAdmin(), LANE_FIELDS)
    if (error) return withCorsJson(req, { ok: false, error }, error === "Forbidden" ? 403 : 404)
    return withCorsJson(req, { ok: true, lane }, 200)
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
    if (!wantsTitles && !wantsActive) {
      return withCorsJson(req, { ok: false, error: "nothing to update — send titles, active, or both" }, 400)
    }

    const update: { titles?: string[]; active?: boolean } = {}

    if (wantsActive) {
      if (typeof body.active !== "boolean") {
        return withCorsJson(req, { ok: false, error: "active must be true or false" }, 400)
      }
      update.active = body.active
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
