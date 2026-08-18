// app/api/lanes/route.ts
// GET — lanes the caller may see, each with its unreviewed count.
//
// SCOPE. The caller's own lanes plus every client they actively coach, so this
// is the all-clients view for a coach and simply "my lanes" for a client. Each
// lane carries its owner's name, because once a list can span people, a lane
// name alone ("Baseball Operations") no longer says whose queue you are about
// to review.
//
// ?client_profile_id=<uuid> narrows to one owner. The id must be inside the
// caller's own scope — passing someone else's is a 403, not an empty list, so a
// mistake is visible rather than looking like a client with no lanes.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { canAccessLaneOwner, laneScopeIds } from "@/lib/collab/laneAccess"
import { runLaneLogged, type Lane } from "@/lib/laneRunner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// POST creates a lane and then runs it, which is several board requests.
export const maxDuration = 300

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const requested = new URL(req.url).searchParams.get("client_profile_id")

    const scope = await laneScopeIds(profileId, supabase)
    if (requested && !scope.includes(requested)) {
      return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    }
    const owners = requested ? [requested] : scope

    // Returned so an empty list can say WHOSE list is empty. Lanes are owned
    // per profile and this app has many test accounts, so "no lanes" is nearly
    // always a question of which account rather than of none existing — and an
    // empty state that cannot tell you that sends you off creating a duplicate.
    const { data: profiles } = await supabase
      .from("client_profiles")
      .select("id, name, email")
      .in("id", owners)
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]))

    // Whether the caller may score a result onto this owner's tracker. Resolved
    // per OWNER rather than per lane: the answer is a property of the coaching
    // relationship, and a coach with twenty lanes for one client should not cost
    // twenty access checks.
    const canSend = new Map<string, boolean>()
    for (const owner of owners) {
      canSend.set(owner, await canAccessLaneOwner(owner, profileId, "send", supabase))
    }

    const { data, error } = await supabase
      .from("search_lanes")
      .select("id, client_profile_id, name, active, titles, keyword, location, years_max")
      .in("client_profile_id", owners)
      .order("created_at", { ascending: true })
    if (error) throw new Error(`Lanes failed: ${error.message}`)

    // Queue depth per lane. Counted here rather than joined so the number
    // means the same thing as the review page's own filter — action IS NULL.
    const lanes = await Promise.all(
      (data ?? []).map(async (l: any) => {
        const { count } = await supabase
          .from("lane_results")
          .select("id", { count: "exact", head: true })
          .eq("lane_id", l.id)
          .is("action", null)
        const owner = byId.get(l.client_profile_id)
        return {
          ...l,
          unreviewed: count ?? 0,
          client_name: owner?.name ?? null,
          client_email: owner?.email ?? null,
          is_own: l.client_profile_id === profileId,
          can_send: canSend.get(l.client_profile_id) ?? false,
        }
      })
    )

    const self = byId.get(profileId)
    return withCorsJson(
      req,
      {
        ok: true,
        profile: self ?? { id: profileId },
        // The scope this list was built from, so a UI can distinguish "you
        // coach nobody" from "your clients have no lanes".
        scope_size: scope.length,
        lanes,
      },
      200
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

// ---------------------------------------------------------------------------
// POST — create a lane, and run it once
// ---------------------------------------------------------------------------
// Creating a lane and running it are one action from the coach's side: a lane
// that exists but has never run is an empty queue, which looks exactly like a
// lane that found nothing. So the create call runs it before returning, and
// reports what the run found.
//
// A failed FIRST RUN does not fail the create. The lane is saved and correct;
// the run can be retried by the nightly sweep or by hand, and rolling back a
// good lane because a third party had a bad minute would be worse. The response
// says which happened.

const MAX_TITLES = 12
const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

export async function POST(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const body = await req.json().catch(() => ({}))

    const clientProfileId = typeof body?.client_profile_id === "string" ? body.client_profile_id : null
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "client_profile_id required" }, 400)
    if (!(await canAccessLaneOwner(clientProfileId, profileId, "send", supabase))) {
      return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)
    }

    const name = String(body?.name ?? "").trim()
    if (!name) return withCorsJson(req, { ok: false, error: "name required" }, 400)

    if (!Array.isArray(body?.titles) || !body.titles.every((t: unknown) => typeof t === "string")) {
      return withCorsJson(req, { ok: false, error: "titles must be an array of strings" }, 400)
    }
    const seen = new Set<string>()
    const titles: string[] = []
    for (const raw of body.titles as string[]) {
      const t = normTitle(raw)
      if (!t || seen.has(t)) continue
      seen.add(t)
      titles.push(t)
    }
    if (!titles.length) return withCorsJson(req, { ok: false, error: "a lane needs at least one title" }, 400)
    if (titles.length > MAX_TITLES) {
      return withCorsJson(req, { ok: false, error: `at most ${MAX_TITLES} titles (got ${titles.length})` }, 400)
    }

    // location must state its markets explicitly, including the empty list that
    // means "no geographic filter". An absent key is a lane nobody scoped, and
    // the runner refuses it rather than guessing in either direction.
    const location = body?.location
    const hasPresets = location && typeof location === "object" && Array.isArray((location as any).presets)
    const hasLegacy = location && typeof location === "object" && "preset" in (location as any)
    if (!hasPresets && !hasLegacy) {
      return withCorsJson(
        req,
        { ok: false, error: 'location must state presets — a list of market keys, or [] for no geographic filter' },
        400
      )
    }
    if (hasPresets && !(location as any).presets.every((x: unknown) => typeof x === "string")) {
      return withCorsJson(req, { ok: false, error: "location.presets must all be strings" }, 400)
    }

    // Board filters. Four optional string lists; anything else is rejected
    // rather than coerced, because a filter silently dropped is a lane quietly
    // searching wider than the coach believes.
    const FILTER_KEYS = ["industries", "excluded_industries", "company_keywords", "excluded_company_keywords"] as const
    const filters: Record<string, string[]> = {}
    const rawFilters = body?.filters && typeof body.filters === "object" ? body.filters : null
    if (rawFilters) {
      for (const key of FILTER_KEYS) {
        const v = (rawFilters as any)[key]
        if (v === undefined || v === null) continue
        if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === "string")) {
          return withCorsJson(req, { ok: false, error: `filters.${key} must be an array of strings` }, 400)
        }
        const cleaned = v.map((x: string) => x.trim()).filter(Boolean)
        if (cleaned.length) filters[key] = cleaned
      }
    } else {
      // No filters supplied: inherit the client's standing industry preference,
      // which is what makes "this client never wants school jobs" hold for every
      // lane rather than only the one where somebody remembered.
      const { data: prof } = await supabase
        .from("client_profiles")
        .select("target_industries, excluded_industries")
        .eq("id", clientProfileId)
        .maybeSingle()
      const inc = ((prof as any)?.target_industries ?? []) as string[]
      const exc = ((prof as any)?.excluded_industries ?? []) as string[]
      if (inc.length) filters.industries = inc
      if (exc.length) filters.excluded_industries = exc
    }

    const keywordRaw = typeof body?.keyword === "string" ? body.keyword.trim() : ""
    const yearsMax = body?.years_max === null || body?.years_max === undefined ? null : Number(body.years_max)
    if (yearsMax !== null && (!Number.isFinite(yearsMax) || yearsMax < 0)) {
      return withCorsJson(req, { ok: false, error: "years_max must be a non-negative number or null" }, 400)
    }

    const { data: lane, error: insErr } = await supabase
      .from("search_lanes")
      .insert({
        client_profile_id: clientProfileId,
        name,
        active: true,
        titles,
        // Empty string is rejected by the column CHECK; null is the one
        // representation of "no keyword".
        keyword: keywordRaw || null,
        location,
        years_max: yearsMax,
        companies: Array.isArray(body?.companies) ? body.companies : [],
        exclusions: body?.exclusions && typeof body.exclusions === "object" ? body.exclusions : {},
        filters,
      })
      .select("*")
      .single()
    if (insErr) {
      // The owner+name unique constraint is the one a coach can actually hit.
      const conflict = /duplicate key|unique/i.test(insErr.message)
      return withCorsJson(
        req,
        { ok: false, error: conflict ? `This client already has a lane called "${name}"` : insErr.message },
        conflict ? 409 : 500
      )
    }

    const outcome = await runLaneLogged(lane as Lane, supabase, "manual")
    const run = outcome.ok
      ? {
          added: outcome.result.added,
          refreshed: outcome.result.refreshed,
          found: outcome.found,
          titles: outcome.result.perTitle,
        }
      : null
    const runError = outcome.ok ? null : outcome.error

    return withCorsJson(req, { ok: true, lane, run, run_error: runError }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
