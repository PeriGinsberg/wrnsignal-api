// app/api/jobfit-run-trial/route.ts
//
// Free-trial JobFit endpoint. One-shot, real run (resume + JD), gated to
// one execution per email. Replaces the prior trial route which passed
// only profileText (no profileOverrides) and produced lower-quality
// scoring than the paid path.
//
// Flow:
//   1. Validate inputs.
//   2. Hash JD body (SHA256) for cache + idempotency.
//   3. Look up jobfit_users by email.
//      - Existing user, credits_remaining === 0:
//          - Same JD as before → return cached result with locked: true
//          - Different JD → return out_of_credits with no result payload
//      - Existing user, credits_remaining > 0 → proceed.
//      - New user → insert with credits_remaining = 1, proceed.
//   4. Upsert jobfit_profiles (email, resume_text, intake-only profile_text;
//      target_roles/target_locations/timeline/job_type nulled).
//   5. Haiku pre-pass: inferProfileOverridesFromResume(resume_text).
//   6. profileText = stripped profile_text + "\n\nResume:\n" + resume_text.
//   7. runJobFit({ profileText, jobText, profileOverrides }).
//   8. V5 bullet renderer (generateBulletsV5).
//   9. Build response with locks + upgrade metadata.
//   10. Cache insert (jobfit_trial_runs) BEFORE credit decrement — if the
//       decrement fails, the cache hit on retry prevents re-burning Haiku
//       and V5 spend (per design: better to over-cache than under-cache).
//   11. Decrement jobfit_users.credits_remaining to 0.
//   12. Return.
//
// Failure modes around the two-write step (10 + 11):
//   - Cache insert fails before decrement → no cache row, credits intact;
//     user can retry, gets a fresh run. Acceptable.
//   - Cache insert succeeds, decrement fails → cache exists, credits
//     intact. Future SAME-JD request hits cache. Future DIFFERENT-JD
//     request gets a second free run (over-cache cost). Acceptable per
//     spec ("better to over-cache than under-cache").
//   - Both fail → return 500. User can retry. No state corruption.

import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { generateBulletsV5 } from "../jobfit/bulletGeneratorV5"
import { inferProfileOverridesFromResume } from "../_lib/inferProfileOverridesFromResume"
import type { StructuredProfileSignals } from "../jobfit/signals"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const maxDuration = 90
export const dynamic = "force-dynamic"

const MIN_RESUME_CHARS = 100
const MIN_JD_CHARS = 100
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Default upgrade target. The frontend wires this either as a direct
// navigation hint or invokes its existing handleUpgrade flow (which POSTs
// to /api/checkout/create-session and receives the actual Stripe URL).
// Configurable via env so prod and staging can point at different
// destinations without a code change.
const UPGRADE_BASE =
  process.env.SIGNAL_TRIAL_UPGRADE_URL ||
  "https://wrnsignal.workforcereadynow.com/signal/jobfit"

const UPGRADE_PRICE = "$99"
const UPGRADE_TERM = "3 months"
const UPGRADE_GUARANTEE = "7-day money-back"

type LockEntry = { label: string; stripe_url: string }
type Locks = {
  cover_letter: LockEntry
  networking: LockEntry
  resume_positioning: LockEntry
  tracker: LockEntry
  run_another_job: LockEntry
}

function buildStripeUrl(email: string, source: string): string {
  return `${UPGRADE_BASE}?email=${encodeURIComponent(email)}&source=${encodeURIComponent(source)}`
}

function buildLocks(email: string): Locks {
  const url = buildStripeUrl(email, "trial_locked")
  return {
    cover_letter: { label: "Cover Letter", stripe_url: url },
    networking: { label: "Networking Campaign", stripe_url: url },
    resume_positioning: { label: "Resume Positioning", stripe_url: url },
    tracker: { label: "Application Tracker", stripe_url: url },
    run_another_job: { label: "Analyze Another Job", stripe_url: url },
  }
}

function buildUpgrade(email: string) {
  return {
    price: UPGRADE_PRICE,
    term: UPGRADE_TERM,
    guarantee: UPGRADE_GUARANTEE,
    stripe_url: buildStripeUrl(email, "trial_upgrade_cta"),
  }
}

// Strip an embedded "Resume:\n..." block from a profile_text blob if one
// is present. Mirrors assembleProfileForScoring's defensive read pattern
// — never trust that a profile_text column is intake-only, even when we
// believe we wrote it that way. Trial profile_text writes are intake-only
// by construction, but we still apply the strip so a stale row never
// double-feeds resume body into runJobFit.
function stripEmbeddedResume(profileText: string): string {
  let s = String(profileText || "").trim()
  const idx = s.search(/\n\s*Resume:\s*\n/i)
  if (idx !== -1) s = s.slice(0, idx).trim()
  return s
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  const t0 = Date.now()

  try {
    // ── Optional ingest-key gate (defense-in-depth; dormant when env unset) ──
    const expectedKey = process.env.JOBFIT_INGEST_KEY
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key")
      if (got !== expectedKey) {
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    // ── Parse + validate body ────────────────────────────────────────
    let body: any
    try {
      body = await req.json()
    } catch {
      return withCorsJson(req, { ok: false, error: "invalid_json" }, 400)
    }
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "invalid_body" }, 400)
    }

    const email = String(body.email ?? "").trim().toLowerCase()
    const resumeText = String(body.resume_text ?? "").trim()
    const jobText = String(body.job_description ?? "").trim()
    const sessionId = body.session_id ? String(body.session_id).slice(0, 200) : null
    const utmSource = body.utm_source ? String(body.utm_source).slice(0, 100) : null
    const utmMedium = body.utm_medium ? String(body.utm_medium).slice(0, 100) : null
    const utmCampaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null

    if (!email || !EMAIL_RE.test(email)) {
      return withCorsJson(req, { ok: false, error: "invalid_email" }, 400)
    }
    if (resumeText.length < MIN_RESUME_CHARS) {
      return withCorsJson(
        req,
        { ok: false, error: "resume_too_short", detail: `Need at least ${MIN_RESUME_CHARS} characters of resume text.` },
        400
      )
    }
    if (jobText.length < MIN_JD_CHARS) {
      return withCorsJson(
        req,
        { ok: false, error: "jd_too_short", detail: `Need at least ${MIN_JD_CHARS} characters of job description.` },
        400
      )
    }

    // ── Compute cache key ────────────────────────────────────────────
    const jdHash = crypto.createHash("sha256").update(jobText).digest("hex")

    const supabase = getSupabase()
    const locks = buildLocks(email)
    const upgrade = buildUpgrade(email)

    // ── User + credits lookup ────────────────────────────────────────
    const { data: existingUser, error: userLookupErr } = await supabase
      .from("jobfit_users")
      .select("id, credits_remaining")
      .eq("email", email)
      .maybeSingle()

    if (userLookupErr) {
      console.error("[jobfit-run-trial] user lookup failed:", userLookupErr.message)
      return withCorsJson(req, { ok: false, error: "user_lookup_failed" }, 500)
    }

    let userId: string

    if (existingUser) {
      userId = existingUser.id
      const credits = existingUser.credits_remaining ?? 0

      if (credits <= 0) {
        // Out of credits. Check whether this exact JD has a cached result.
        const { data: cached, error: cacheErr } = await supabase
          .from("jobfit_trial_runs")
          .select("result_json")
          .eq("email", email)
          .eq("jd_hash", jdHash)
          .maybeSingle()

        if (cacheErr) {
          console.error("[jobfit-run-trial] cache lookup failed:", cacheErr.message)
          return withCorsJson(req, { ok: false, error: "cache_lookup_failed" }, 500)
        }

        if (cached?.result_json) {
          // Same email + same JD → return their original analysis.
          return withCorsJson(
            req,
            {
              status: "ok",
              locked: true,
              lock_reason: "free_run_used",
              result: cached.result_json,
              locks,
              upgrade,
            },
            200
          )
        }

        // Same email + different JD → upgrade-only page; no result payload.
        return withCorsJson(
          req,
          {
            status: "out_of_credits",
            locked: true,
            lock_reason: "free_run_used",
            result: null,
            locks,
            upgrade,
          },
          200
        )
      }
      // credits > 0 → fall through to proceed
    } else {
      // New user. credits_remaining = 1 specifically for this flow (the
      // table default of 3 is preserved for any other trial path that may
      // depend on it).
      const { data: newUser, error: insertErr } = await supabase
        .from("jobfit_users")
        .insert({ email, credits_remaining: 1 })
        .select("id")
        .single()

      if (insertErr || !newUser) {
        console.error(
          "[jobfit-run-trial] user insert failed:",
          insertErr?.message ?? "(no error message)"
        )
        return withCorsJson(req, { ok: false, error: "user_insert_failed" }, 500)
      }
      userId = newUser.id
    }

    // ── Upsert profile (intake-only profile_text) ────────────────────
    const profileTextForDb = `Email: ${email}`
    const { error: profileErr } = await supabase.from("jobfit_profiles").upsert(
      {
        user_id: userId,
        email,
        resume_text: resumeText,
        profile_text: profileTextForDb,
        target_roles: null,
        target_locations: null,
        timeline: null,
        job_type: null,
      },
      { onConflict: "user_id" }
    )
    if (profileErr) {
      console.error("[jobfit-run-trial] profile upsert failed:", profileErr.message)
      return withCorsJson(req, { ok: false, error: "profile_upsert_failed" }, 500)
    }

    // ── Haiku pre-pass for structured overrides ──────────────────────
    // Fails open: returns {} on any error so the engine falls back to its
    // own heuristic detectors. Don't bail the whole run on a Haiku miss.
    const profileOverrides = await inferProfileOverridesFromResume(resumeText)

    // ── Trial-only neutralization of inferred preferences ───────────
    //
    // The deterministic engine (extract.ts heuristics + scoring.ts gates and
    // penalties) treats every constraint and preference field on the profile
    // as a STATED user preference. On the paid path that's correct — those
    // fields come from the intake form, where the user explicitly answered
    // questions about location, employment type, and target career
    // direction. Paid users see the engine's full constraint behavior
    // intact, and that path is unchanged.
    //
    // On the trial path there is NO intake form. We only have the resume and
    // a Haiku pre-pass that infers signals from it. Both are guesses, not
    // declarations:
    //   - extract.ts:2827-2850 (defaultConstraintsFromText) defaults each
    //     constraint by scanning profile body text for phrases like "no
    //     remote" or "full-time" — surfacing patterns that may appear
    //     incidentally in a resume as if the user had stated them.
    //   - inferProfileOverridesFromResume sets prefFullTime=true whenever
    //     Haiku classifies the resume as "full_time"-targeting, and sets
    //     locationPreference.constrained=true plus allowedCities to whatever
    //     city Haiku finds in the resume (often the candidate's address).
    //   - extract.ts:4227 falls back to targetFamilies=["Sales"] when
    //     neither tag detection nor Haiku produces any family — turning a
    //     sparse resume into an asserted Sales target.
    //
    // The audit (see prior conversation) showed this triggers false-positive
    // gates and penalties for trial users: GATE_FLOOR_REVIEW_CONTRACT for
    // resumes that mention "full-time", GATE_FLOOR_REVIEW_LOCATION for
    // resumes that list a home city, and GATE_FIELD_MISMATCH (force_pass)
    // for sparse resumes against hard-tech JDs. None of these reflect a
    // preference the trial user actually expressed.
    //
    // Override strategy:
    //   - constraints.* : force every field to false. Trial users have not
    //     stated any hard-no or pref. The engine should treat them as
    //     "no preference expressed" until the upgrade path captures real
    //     intake input.
    //   - locationPreference: force to neutral (mode=unclear, constrained=
    //     false, allowedCities=[]). "unclear" is the only valid neutral
    //     LocationMode (not_constrained is a LocationConstraint, not a
    //     LocationMode — see signals.ts:8 vs :55).
    //   - targetFamilies: CONDITIONAL — preserve Haiku's inference when it
    //     succeeded (so the +10 family-match bonus still fires for clearly-
    //     classified candidates), but force [] when Haiku failed. Empty
    //     array is the "no opinion" state both for the family-mismatch
    //     penalty (scoring.ts:802 checks length>0) and the GATE_FIELD_MISMATCH
    //     gate (constraints.ts:67 checks length>0). This avoids the
    //     ["Sales"] fallback in extract.ts:4227 while keeping legitimate
    //     family classification intact.
    //
    // statedInterests.targetRoles is intentionally NOT overridden — it
    // produces only positive effects in scoring.ts (title-match bonus,
    // family-mismatch suppression) and never penalties.
    const haikuFamilies = profileOverrides.targetFamilies ?? []

    const trialOverrides: Partial<StructuredProfileSignals> = {
      ...profileOverrides,
      constraints: {
        hardNoSales: false,
        hardNoGovernment: false,
        hardNoContract: false,
        hardNoHourlyPay: false,
        hardNoFullyRemote: false,
        preferNotAnalyticsHeavy: false,
        hardNoContentOnly: false,
        hardNoPartTime: false,
        prefFullTime: false,
      },
      locationPreference: {
        mode: "unclear",
        constrained: false,
        allowedCities: [],
      },
      // Preserve Haiku's family inference when it succeeded; force [] only
      // when Haiku failed (which would otherwise fall back to ["Sales"] in
      // extract.ts and trigger GATE_FIELD_MISMATCH on hard-tech JDs).
      targetFamilies: haikuFamilies.length > 0 ? haikuFamilies : [],
    }

    // ── Build effective profileText (defensive strip) ────────────────
    const profileHeader = stripEmbeddedResume(profileTextForDb)
    const effectiveProfileText =
      (profileHeader ? profileHeader + "\n\n" : "") + "Resume:\n" + resumeText

    // ── Run the deterministic engine ─────────────────────────────────
    let raw: any
    try {
      raw = await runJobFit({
        profileText: effectiveProfileText,
        jobText,
        profileOverrides: trialOverrides,
      })
    } catch (err: any) {
      console.error("[jobfit-run-trial] runJobFit failed:", err?.message || String(err))
      return withCorsJson(req, { ok: false, error: "scoring_failed" }, 500)
    }

    // ── V5 bullet renderer ───────────────────────────────────────────
    // Mirror runJobFitForProfile.ts:354-365 — V5 needs profile_text and
    // job_text on the input object alongside the engine output.
    try {
      const v5 = await generateBulletsV5({
        ...raw,
        profile_text: effectiveProfileText,
        job_text: jobText,
      } as any)
      raw.why = v5.why
      raw.risk = v5.risk
      raw.bullets = v5.why
      raw.risk_bullets = v5.risk
      raw.why_structured = v5.why_structured
      raw.risk_structured = v5.risk_structured
      raw.cover_letter_strategy = v5.cover_letter_strategy
      raw.positioning_strategy = v5.positioning_strategy
      raw.networking_strategy = v5.networking_strategy
      raw.debug = { ...(raw.debug || {}), ...v5.renderer_debug }
    } catch (err: any) {
      // V5 failure: fall back to V4-rendered bullets that are already on
      // `raw` from runJobFit. This matches the paid-path fallback at
      // runJobFitForProfile.ts:376-384 — graceful degradation, not a 500.
      const v5ErrorMessage = err?.message || String(err)
      console.error(
        "[jobfit-run-trial] V5 bullet generator failed, falling back to V4:",
        v5ErrorMessage
      )
      raw.debug = {
        ...(raw.debug || {}),
        v5_error: v5ErrorMessage,
        v5_fell_back_to_v4: true,
      }
    }

    // ── Build success response ───────────────────────────────────────
    // Notes on what's intentionally NOT in this response:
    //   - profile_signals: deep engine state (inferred families, targetRoles,
    //     constraints). Trial users have no use for this and exposing it
    //     invites "why does it think I'm targeting X" support pings.
    //   - score_breakdown: debug telemetry, not user-facing.
    //
    // why_codes / risk_codes / gate_triggered are FRONTEND-INTERNAL — they
    // are exposed so the UI can render gate-aware messaging (e.g. a
    // force_pass gate deserves different framing than a normal Pass) and
    // fall back to deterministic strings if the V5 bullets render oddly.
    // Do NOT surface these as raw display strings to the user.
    const successResponse = {
      status: "ok" as const,
      locked: false,
      lock_reason: "none" as const,
      result: {
        decision: raw.decision,
        score: raw.score,
        icon: raw.icon,
        next_step: raw.next_step,
        location_constraint: raw.location_constraint,
        bullets: raw.bullets ?? [],
        risk: raw.risk ?? [],
        why: raw.why ?? raw.bullets ?? [],
        why_structured: raw.why_structured ?? [],
        risk_structured: raw.risk_structured ?? [],
        // Frontend-internal — see header note above.
        why_codes: raw.why_codes ?? [],
        risk_codes: raw.risk_codes ?? [],
        gate_triggered: raw.gate_triggered,
        job_signals: raw.job_signals,
        cover_letter_strategy: raw.cover_letter_strategy ?? null,
        positioning_strategy: raw.positioning_strategy ?? null,
        networking_strategy: raw.networking_strategy ?? null,
      },
      locks,
      upgrade,
    }

    // ── Cache insert FIRST (per design: cache-before-decrement) ──────
    // ON CONFLICT DO NOTHING is enforced by the (email, jd_hash) unique
    // constraint — a no-op on a re-submission of the same JD by the same
    // email. We surface the underlying row's existing result_json on the
    // out-of-credits path above; here we just protect against double-write.
    const { error: cacheInsertErr } = await supabase
      .from("jobfit_trial_runs")
      .insert({
        email,
        jd_hash: jdHash,
        result_json: successResponse.result,
      })
    if (cacheInsertErr) {
      // Unique-constraint violation is acceptable (idempotent re-run).
      // Anything else means the row didn't land — log and continue but
      // skip the credit decrement. Better to leave credits intact and
      // let the user retry than to lock them out without a cached result.
      const isUniqueViolation = String(cacheInsertErr.code) === "23505"
      if (!isUniqueViolation) {
        console.error(
          "[jobfit-run-trial] cache insert failed (skipping credit decrement):",
          cacheInsertErr.message
        )
        return withCorsJson(req, { ok: false, error: "cache_insert_failed" }, 500)
      }
    }

    // ── Decrement credits to 0 ───────────────────────────────────────
    const { error: decrementErr } = await supabase
      .from("jobfit_users")
      .update({ credits_remaining: 0, updated_at: new Date().toISOString() })
      .eq("id", userId)
    if (decrementErr) {
      // Cache insert succeeded; decrement failed. User MAY get a second
      // free run with a different JD. Accepted failure mode per spec.
      // Logged for monitoring — surfacing this as a 500 would force the
      // frontend to swallow the result, which is worse than the rare
      // double-spend.
      console.error(
        "[jobfit-run-trial] credit decrement failed (cache already written):",
        decrementErr.message
      )
    }

    // ── Tracking (analytics-phase-2 stub, per existing convention) ───
    console.log("[analytics:deferred]", {
      call_site: "app/api/jobfit-run-trial/route.ts",
      would_have_written: {
        page_name: "jobfit_trial_run_completed",
        session_id: sessionId,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        referrer: req.headers.get("referer") || null,
        elapsed_ms: Date.now() - t0,
      },
    })

    return withCorsJson(req, successResponse, 200)
  } catch (err: any) {
    console.error("[jobfit-run-trial] unexpected error:", err?.message || String(err))
    return withCorsJson(
      req,
      { ok: false, error: err?.message || "internal_error" },
      500
    )
  }
}
