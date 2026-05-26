// app/api/jobfit-run-trial-open/route.ts
//
// Unlimited free-trial JobFit endpoint for the new landing-page funnel.
//
// Differences from jobfit-run-trial:
//   - No email required (no jobfit_users / jobfit_profiles writes)
//   - No credit gate (every request runs)
//   - No DB cache (client persists last result in sessionStorage by jd_hash)
//   - Soft per-IP rate limit (in-memory, best-effort) to bound abuse cost
//   - Anonymous analytics insert (jobfit_anonymous_runs) — fire-and-forget,
//     no PII, hashes only; never blocks the response; insert failures
//     are console.error'd, never surfaced to the user
//
// Same as jobfit-run-trial:
//   - Engine path: runJobFit + V5 bullet renderer
//   - Trial-neutral profileOverrides (constraints zeroed, locationPreference
//     unclear, targetFamilies preserved only when Haiku succeeded)
//   - Response shape (status=ok, locked=false, result, locks, upgrade)
//   - locks/upgrade reuse the same stripe_url builder; with no email, the
//     URL omits the email query param and lands on the generic upgrade page
//
// The existing gated /api/jobfit-run-trial route remains unchanged and is
// still wired to the existing /signal/jobfit-run-trial intake page. The
// two endpoints run in parallel; deprecation decision deferred.

import crypto from "crypto"
import { NextRequest } from "next/server"
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

// Upgrade target (same env var as gated trial — stays consistent across
// trial flows; configurable per environment).
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

function buildStripeUrl(source: string): string {
  // No email available on this funnel — upgrade page is generic.
  return `${UPGRADE_BASE}?source=${encodeURIComponent(source)}`
}

function buildLocks(): Locks {
  const url = buildStripeUrl("trial_locked")
  return {
    cover_letter: { label: "Cover Letter", stripe_url: url },
    networking: { label: "Networking Campaign", stripe_url: url },
    resume_positioning: { label: "Resume Positioning", stripe_url: url },
    tracker: { label: "Application Tracker", stripe_url: url },
    run_another_job: { label: "Analyze Another Job", stripe_url: url },
  }
}

function buildUpgrade() {
  return {
    price: UPGRADE_PRICE,
    term: UPGRADE_TERM,
    guarantee: UPGRADE_GUARANTEE,
    stripe_url: buildStripeUrl("trial_upgrade_cta"),
  }
}

// ── Soft per-IP rate limit ──────────────────────────────────────────────
// Best-effort, in-memory. Each warm Vercel function instance keeps its own
// counter; cold starts reset state and concurrent regions don't share. This
// catches casual abuse (back-button mashing, single-IP burst) without
// promising hard enforcement. For hard rate limiting move to Upstash/Redis.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_PER_WINDOW = 10
const ipHits = new Map<string, number[]>()

function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  if (!ip) return { ok: true } // No IP header → can't enforce; allow.
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const prior = (ipHits.get(ip) ?? []).filter((t) => t > cutoff)
  if (prior.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    const oldest = prior[0]!
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000))
    return { ok: false, retryAfterSec }
  }
  prior.push(now)
  ipHits.set(ip, prior)
  // Opportunistic cleanup so the map doesn't grow unbounded on the warm
  // instance. Cap roughly: prune any IP whose window has fully aged out.
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter((t) => t > cutoff)
      if (fresh.length === 0) ipHits.delete(k)
      else ipHits.set(k, fresh)
    }
  }
  return { ok: true }
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    ""
  )
}

// Service-role Supabase client. Used only for the fire-and-forget
// anonymous analytics insert below. The open route has no other DB
// interaction. Per-request instantiation mirrors the gated trial route
// (jobfit-run-trial/route.ts:114-121); the helper throws synchronously
// if env is unset so the analytics block's try/catch can swallow it
// without surfacing 500 to the user.
function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  try {
    // ── Optional ingest-key gate (parity with jobfit-run-trial) ──────
    const expectedKey = process.env.JOBFIT_INGEST_KEY
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key")
      if (got !== expectedKey) {
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    // ── Rate limit ───────────────────────────────────────────────────
    const ip = getClientIp(req)
    const limit = checkRateLimit(ip)
    if (!limit.ok) {
      return withCorsJson(
        req,
        { ok: false, error: "rate_limited", retry_after_sec: limit.retryAfterSec },
        429
      )
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

    const resumeText = String(body.resume_text ?? "").trim()
    const jobText = String(body.job_description ?? "").trim()
    const sessionId = body.session_id ? String(body.session_id).slice(0, 200) : null
    const utmSource = body.utm_source ? String(body.utm_source).slice(0, 100) : null
    const utmMedium = body.utm_medium ? String(body.utm_medium).slice(0, 100) : null
    const utmCampaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null

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

    const locks = buildLocks()
    const upgrade = buildUpgrade()

    // ── Haiku pre-pass for structured overrides ──────────────────────
    // Fails open: returns {} on any error so the engine falls back to its
    // heuristic detectors. Mirrors jobfit-run-trial behavior.
    const profileOverrides = await inferProfileOverridesFromResume(resumeText)

    // ── Trial-neutral overrides ──────────────────────────────────────
    // Same baseline as jobfit-run-trial — no intake form on this funnel,
    // so every constraint/preference is forced to "no preference
    // expressed". See jobfit-run-trial/route.ts for the long-form
    // rationale (resume-derived signals are guesses, not declarations).
    //
    // targetFamilies is forced to [] on the open path — STRICTER than
    // jobfit-run-trial, which preserves Haiku's family inference when
    // confident. The reason: V5 risk bullets phrase family-mismatch as
    // "your stated target is X" — but open-flow users have stated NOTHING.
    // A Haiku guess showing up as a "stated target" mismatch was reported
    // in prod (a high-school student's resume tagged as "Sales target"
    // against an entertainment role). Forcing [] suppresses both the
    // family-mismatch Risk AND the family-match Bonus. For trial users
    // with no stated career intent, that's the right trade — score the
    // scan on actual evidence, not on inferred career trajectory.
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
      targetFamilies: [],
    }

    // ── Effective profileText (no intake header on this funnel) ──────
    const effectiveProfileText = "Resume:\n" + resumeText

    // ── Run the deterministic engine ─────────────────────────────────
    let raw: any
    try {
      raw = await runJobFit({
        profileText: effectiveProfileText,
        jobText,
        profileOverrides: trialOverrides,
      })
    } catch (err: any) {
      console.error("[jobfit-run-trial-open] runJobFit failed:", err?.message || String(err))
      return withCorsJson(req, { ok: false, error: "scoring_failed" }, 500)
    }

    // ── V5 bullet renderer (graceful fall back to V4 on failure) ─────
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
      const v5ErrorMessage = err?.message || String(err)
      console.error(
        "[jobfit-run-trial-open] V5 bullet generator failed, falling back to V4:",
        v5ErrorMessage
      )
      raw.debug = {
        ...(raw.debug || {}),
        v5_error: v5ErrorMessage,
        v5_fell_back_to_v4: true,
      }
    }

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

    // ── Tracking (analytics-phase-2 stub, per existing convention) ───
    // jd_hash is logged so prod investigations can correlate a run with the
    // submitted JD without storing the JD itself.
    const jdHash = crypto.createHash("sha256").update(jobText).digest("hex")
    console.log("[analytics:deferred]", {
      call_site: "app/api/jobfit-run-trial-open/route.ts",
      would_have_written: {
        page_name: "jobfit_trial_open_run_completed",
        session_id: sessionId,
        jd_hash: jdHash,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        referrer: req.headers.get("referer") || null,
        ip,
        elapsed_ms: Date.now() - t0,
      },
    })

    // ──────────────────────────────────────────────────────────────────
    // Anonymous analytics. Fire-and-forget. Never blocks the response.
    // No PII written. Errors are logged, never surfaced to the user.
    // ──────────────────────────────────────────────────────────────────
    try {
      const supabase = getSupabase()
      const resumeHash = crypto
        .createHash("sha256")
        .update(resumeText)
        .digest("hex")

      const v5FellBackToV4 = Boolean(raw?.debug?.v5_fell_back_to_v4)

      const analyticsPayload = {
        // session correlation
        session_id: sessionId ?? null,

        // attribution (already parsed from body earlier in the route)
        utm_source: utmSource ?? null,
        utm_medium: utmMedium ?? null,
        utm_campaign: utmCampaign ?? null,
        referrer: req.headers.get("referer") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,

        // inputs (hashed only)
        resume_hash: resumeHash,
        jd_hash: jdHash, // already computed upstream in the route
        resume_char_count: resumeText.length,
        jd_char_count: jobText.length,

        // engine outputs
        score: typeof raw?.score === "number" ? raw.score : null,
        decision: raw?.decision ?? null,
        gate_triggered: raw?.gate_triggered?.type ?? null,
        why_code_count: Array.isArray(raw?.why_codes) ? raw.why_codes.length : 0,
        risk_code_count: Array.isArray(raw?.risk_codes) ? raw.risk_codes.length : 0,

        // engine behavior
        v5_fell_back_to_v4: v5FellBackToV4,

        // performance
        ms_elapsed: Date.now() - t0,
      }

      // No await. Response returns immediately.
      supabase
        .from("jobfit_anonymous_runs")
        .insert(analyticsPayload)
        .then(({ error }) => {
          if (error) {
            console.error("[anonymous_runs] insert_failed", {
              message: error.message,
              code: (error as any).code,
            })
          }
        })
    } catch (analyticsErr: any) {
      console.error(
        "[anonymous_runs] setup_failed",
        analyticsErr?.message || String(analyticsErr)
      )
    }

    return withCorsJson(req, successResponse, 200)
  } catch (err: any) {
    console.error("[jobfit-run-trial-open] unexpected error:", err?.message || String(err))
    return withCorsJson(
      req,
      { ok: false, error: err?.message || "internal_error" },
      500
    )
  }
}
