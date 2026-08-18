// app/api/lanes/[id]/route.ts
// GET   — one lane's full config, for the edit screen.
// PATCH { titles: string[] } — replace the lane's title list.
//
// SCOPE. PATCH writes titles and nothing else. Keyword, location, years_max and
// exclusions are shown on the edit screen but not writable here: each one has a
// failure mode that needs its own guard (a bad location preset returns a fake
// zero-result, a keyword can silently empty the lane), and a route that accepts
// them all would have to grow those guards before it was safe. Titles are the
// field title-discovery produces, so titles are what this accepts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

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

async function loadOwnedLane(id: string, profileId: string) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from("search_lanes").select(LANE_FIELDS).eq("id", id).maybeSingle()
  if (!data) return { error: "Lane not found", status: 404 as const, lane: null }
  if ((data as any).client_profile_id !== profileId) {
    return { error: "Forbidden", status: 403 as const, lane: null }
  }
  return { error: null, status: 200 as const, lane: data as any }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await resolveCaller(req)
    const { id } = await params
    const { error, status, lane } = await loadOwnedLane(id, profileId)
    if (error) return withCorsJson(req, { ok: false, error }, status)
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

    if (!Array.isArray(body?.titles)) {
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

    const { error, status } = await loadOwnedLane(id, profileId)
    if (error) return withCorsJson(req, { ok: false, error }, status)

    const supabase = getSupabaseAdmin()
    const { data, error: upErr } = await supabase
      .from("search_lanes")
      .update({ titles })
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
