// app/api/network/profile/route.ts
// GET  — the client's networking profile, seeding it on first open.
// PATCH — edit fields; records which fields the user has touched.
//
// BOTH the client and their coach may edit (last save wins), per the locked
// template rule. PATCH therefore gates on assertBoardAccess(..., "full") rather
// than the owner-only check every pipeline write uses. That is a DELIBERATE
// exception to "coaches cannot mutate": that rule protects the client's own work
// record (stages, actions, reminders), whereas this profile is shared copy a
// coach is expected to help write.
//
// THE SEED RUNS ON FIRST GET, IN TWO PHASES.
//
// Phase 1 (GET, fast): seven fields that are plain column reads. INSERT ... ON
// CONFLICT DO NOTHING against the existing UNIQUE(client_profile_id), so two
// tabs opening at once cannot double seed. Returns immediately.
//
// Phase 2 (PATCH action:"seed_resume", slow): current_role_title and
// current_employer, which need a live LLM extraction of the résumé. This is a
// SEPARATE round trip on purpose — folding it into the GET meant the first open
// held the whole page on a Haiku call for several seconds, which is a spinner
// over a form the user could otherwise have started filling in. The form renders
// on phase 1 and those two fields fill in when phase 2 lands.
//
// Phase 2 is fire-and-forget from the client but NOT from the server: a
// serverless function can be frozen the moment it responds, so the work has to
// happen inside a request rather than after one.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"
import { extractResumeRoles } from "@/app/api/jobfit/llmResumeExtractor"
import { inferTargetFamilies } from "@/app/api/_lib/jobfitProfileAdapter"
import {
  computeSeed, computeRefresh, completeness, mergeTouched,
  ALL_FIELDS, hasFillableBlanks, computeAutoFill, type SeedSources,
} from "@/lib/network-tracker/client-profile-seed"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ProfileRow = Record<string, string | string[] | null>

const PROFILE_COLS =
  "id, client_profile_id, " + ALL_FIELDS.join(", ") +
  ", touched_fields, seeded_at, resume_seed_attempted_at, created_at, updated_at"

const SOURCE_COLS =
  "id, name, university, target_roles, grad_date, timeline, coach_notes_strengths, profile_structured, resume_text"

// Warm-instance cache for the résumé extraction, mirroring the scoring path's.
// The seed runs once per client, so this mostly avoids re-extracting when a
// refresh follows a seed in the same instance.
const RESUME_CACHE: Record<string, never> = {}

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

/** Reads the 7a sources and resolves the two that need work. */
async function loadSources(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  clientProfileId: string,
  opts: { withResume: boolean },
): Promise<SeedSources & { hasResume: boolean }> {
  const { data: cp } = await supabase
    .from("client_profiles").select(SOURCE_COLS).eq("id", clientProfileId).maybeSingle()

  const structured = (cp?.profile_structured ?? null) as { targetFamilies?: unknown } | null
  const structuredFamilies = Array.isArray(structured?.targetFamilies)
    ? (structured!.targetFamilies as string[])
    : null

  // Fall back to the same inference the scoring path uses, so target_field is
  // populated for clients whose profile_structured was never filled in.
  const families = structuredFamilies ?? (() => {
    try { return inferTargetFamilies(cp?.resume_text ?? "", cp?.target_roles ?? null) as string[] }
    catch { return null }
  })()

  // Most recent role = the one still open (endYear null), else the latest start.
  // Fails open to null: a missing ANTHROPIC_API_KEY or a bad parse leaves these
  // two fields blank and editable rather than failing the seed.
  let currentRole: { title: string; company: string } | null = null
  const resumeText = (cp?.resume_text ?? "").trim()
  if (opts.withResume && resumeText) {
    const roles = await extractResumeRoles(resumeText, { cache: RESUME_CACHE as never, allowLive: true })
    if (roles && roles.length) {
      const open = roles.filter((r) => r.endYear == null)
      const pick = (open.length ? open : roles).sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0]
      if (pick?.title || pick?.company) currentRole = { title: pick.title ?? "", company: pick.company ?? "" }
    }
  }

  return {
    name: cp?.name ?? null,
    university: cp?.university ?? null,
    target_roles: cp?.target_roles ?? null,
    grad_date: cp?.grad_date ?? null,
    timeline: cp?.timeline ?? null,
    coach_notes_strengths: cp?.coach_notes_strengths ?? null,
    targetFamilies: families,
    currentRole,
    hasResume: resumeText.length > 0,
  }
}

/** Cheap existence check — avoids pulling resume_text just to ask "is there one". */
async function hasResumeText(supabase: ReturnType<typeof getSupabaseAdmin>, clientProfileId: string): Promise<boolean> {
  const { data } = await supabase
    .from("client_profiles").select("resume_text").eq("id", clientProfileId).maybeSingle()
  return Boolean((data?.resume_text ?? "").trim())
}

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const target = new URL(req.url).searchParams.get("client_profile_id") || profileId

    const acc = await assertBoardAccess(supabase, profileId, target, "view")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    let { data: row } = await supabase
      .from("network_client_profile").select(PROFILE_COLS).eq("client_profile_id", target).maybeSingle<ProfileRow>()

    // First open: materialise + seed. ON CONFLICT DO NOTHING makes this safe
    // against a second tab racing it.
    if (!row) {
      const seed = computeSeed(await loadSources(supabase, target, { withResume: false }))
      await supabase
        .from("network_client_profile")
        .upsert(
          { client_profile_id: target, ...seed, seeded_at: new Date().toISOString(), touched_fields: [] },
          { onConflict: "client_profile_id", ignoreDuplicates: true },
        )
      const reread = await supabase
        .from("network_client_profile").select(PROFILE_COLS).eq("client_profile_id", target).maybeSingle<ProfileRow>()
      row = reread.data
    }

    // AUTO-FILL. The source data fills in over time and usually after the first
    // open, so a one-shot seed leaves the profile blank. Fill anything still
    // EMPTY and untouched — never anything the user has seen (see computeAutoFill).
    // hasFillableBlanks first, so a settled profile does no extra query at all.
    let autoFilled: string[] = []
    if (row && hasFillableBlanks(row as never, (row.touched_fields as string[]) ?? [])) {
      const fill = computeAutoFill(
        await loadSources(supabase, target, { withResume: false }),
        row as never,
        (row.touched_fields as string[]) ?? [],
      )
      if (Object.keys(fill).length) {
        const { data: refilled } = await supabase
          .from("network_client_profile")
          .update({ ...fill, seeded_at: new Date().toISOString() })
          .eq("client_profile_id", target).select(PROFILE_COLS).single<ProfileRow>()
        if (refilled) row = refilled
        autoFilled = Object.keys(fill)
      }
    }

    // Phase 2 is worth running only when there is a résumé to read, neither
    // field is already filled or user-owned, AND the extraction has not been
    // attempted before — otherwise a résumé that yields no usable role would
    // fire a live LLM call on every single page open.
    const touched = new Set(((row?.touched_fields as string[]) ?? []))
    const resumePending =
      Boolean(row) &&
      !row!.current_role_title && !row!.current_employer &&
      !touched.has("current_role_title") && !touched.has("current_employer") &&
      !row!.resume_seed_attempted_at &&
      (await hasResumeText(supabase, target))

    return withCorsJson(req, {
      ok: true, profile: row, resume_pending: resumePending, auto_filled: autoFilled,
      completeness: completeness((row ?? {}) as never),
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object")
      return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    const target = String(body.client_profile_id || "") || profileId
    // Client AND coach may edit — last save wins, per the locked template rule.
    // 'full' is the strongest coach level; note this is a DELIBERATE exception to
    // "coaches cannot mutate", which is scoped to the PIPELINE (stage, actions,
    // reminders). The networking profile is shared copy a coach is expected to
    // help write, not the client's own work record.
    const acc = await assertBoardAccess(supabase, profileId, target, "full")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { data: existing } = await supabase
      .from("network_client_profile").select("id, touched_fields").eq("client_profile_id", target).maybeSingle()
    if (!existing) return withCorsJson(req, { ok: false, error: "Profile not initialised — open it first." }, 404)

    // ── phase 2 of the seed: the two résumé-derived fields ──
    if (body.action === "seed_resume") {
      const touched = new Set<string>(existing.touched_fields ?? [])
      const src = await loadSources(supabase, target, { withResume: true })
      const patch: Record<string, string> = {}
      for (const [k, v] of Object.entries(computeSeed(src))) {
        // Never clobber a field the user got to first — they may well have typed
        // it while the extraction was still running.
        if (!touched.has(k)) patch[k] = v as string
      }
      // Stamp the ATTEMPT either way — an extraction that finds no usable role
      // must not re-run on every subsequent open.
      const stamp = { resume_seed_attempted_at: new Date().toISOString() }
      if (Object.keys(patch).length === 0) {
        const { data: unchanged } = await supabase
          .from("network_client_profile").update(stamp)
          .eq("client_profile_id", target).select(PROFILE_COLS).single<ProfileRow>()
        return withCorsJson(req, { ok: true, profile: unchanged, completeness: completeness((unchanged ?? {}) as never) }, 200)
      }
      const { data: updated } = await supabase
        .from("network_client_profile").update({ ...patch, ...stamp })
        .eq("client_profile_id", target).select(PROFILE_COLS).single<ProfileRow>()
      return withCorsJson(req, { ok: true, profile: updated, completeness: completeness((updated ?? {}) as never) }, 200)
    }

    // ── refresh from profile: re-seed ONLY untouched fields ──
    if (body.action === "refresh") {
      const patch = computeRefresh(await loadSources(supabase, target, { withResume: true }), existing.touched_fields ?? [])
      const { data: updated } = await supabase
        .from("network_client_profile")
        .update({ ...patch, seeded_at: new Date().toISOString() })
        .eq("client_profile_id", target).select(PROFILE_COLS).single<ProfileRow>()
      return withCorsJson(req, {
        ok: true, profile: updated, refreshed: Object.keys(patch),
        completeness: completeness((updated ?? {}) as never),
      }, 200)
    }

    // ── ordinary edit ──
    const patch: Record<string, string | null> = {}
    for (const f of ALL_FIELDS) {
      if (!(f in body)) continue           // absent key = no-op, so a one-field
      const v = body[f]                     // save cannot mark the other 16 touched
      patch[f] = typeof v === "string" && v.trim() ? v.trim() : null
    }
    if (Object.keys(patch).length === 0)
      return withCorsJson(req, { ok: false, error: "nothing to update" }, 400)

    const { data: updated, error: updErr } = await supabase
      .from("network_client_profile")
      .update({ ...patch, touched_fields: mergeTouched(existing.touched_fields ?? [], Object.keys(patch)) })
      .eq("client_profile_id", target).select(PROFILE_COLS).single<ProfileRow>()
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true, profile: updated, completeness: completeness((updated ?? {}) as never) }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

