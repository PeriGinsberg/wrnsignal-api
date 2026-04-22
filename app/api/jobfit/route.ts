// FILE: app/api/jobfit/route.ts
//
// Goals:
// 1) Local dev: allow deterministic JobFit calls WITHOUT bearer auth when:
//      - NODE_ENV !== "production"
//      - header "x-jobfit-test-key" matches env JOBFIT_TEST_KEY
// 2) Prod/normal: require bearer auth via getAuthedProfileText(req).
// 3) Avoid hard-crashing the dev server at module-import time if Supabase/OpenAI env vars are missing.
//    Supabase caching is best-effort and is only enabled when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exist.
// 4) Always return JSON (never HTML) for errors so curl/regress harness stays stable.
// 5) Keep CORS stable for OPTIONS/POST.
//
// NOTE: This route intentionally does NOT hard-depend on optional modules (profile adapters, V4 stamps, etc).
//       If you want them, wire them in behind dynamic imports inside the authed path.

import crypto from "crypto"
import { type NextRequest } from "next/server"

import { runJobFit } from "../_lib/jobfitEvaluator"
import { getAuthedProfileText } from "../_lib/authProfile"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { extractProfileV4, PROFILE_V4_STAMP } from "../_v4/extractProfileV4"
import { RENDERER_V4_STAMP } from "../jobfit/deterministicBulletRendererV4"
import { extractJobSignals } from "../jobfit/extract"
import { enforceClientFacingRules } from "./enforceClientFacingRules"
import {
  assembleProfileForScoring,
  computeJobFitFingerprint,
  runJobFitForProfile,
  JOBFIT_LOGIC_VERSION,
} from "../_lib/runJobFitForProfile"

import { TAXONOMY_V4_STAMP } from "../_v4/taxonomy"
import { TYPES_V4_STAMP } from "../_v4/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/* ----------------------------------
 * Local bypass
 * ---------------------------------- */
const JOBFIT_TEST_KEY = process.env.JOBFIT_TEST_KEY || ""

function isBypassAllowed(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return false
  if (!JOBFIT_TEST_KEY) return false
  const headerKey = req.headers.get("x-jobfit-test-key") || ""
  return headerKey === JOBFIT_TEST_KEY
}

// Sentinel used in logs when profileId cannot be resolved. JOBFIT_LOGIC_VERSION,
// normalize, and buildFingerprint now live in ../_lib/runJobFitForProfile.
const MISSING = "__MISSING__"

/* ----------------------------------
 * Optional Supabase caching (lazy)
 * ---------------------------------- */
async function getSupabaseAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null

  const mod = await import("@supabase/supabase-js")
  const createClient = mod.createClient

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/* ----------------------------------
 * CORS preflight
 * ---------------------------------- */
export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/* ----------------------------------
 * POST /api/jobfit
 * ---------------------------------- */
export async function POST(req: NextRequest) {
  const ts = Date.now()
  console.log("[jobfit/route] POST hit", { ts })
  console.log("[jobfit/route] ROUTE_FILE_MARKER__LOCAL_RULES_LOCAL_DEV__A")

  try {
    const body = await req.json().catch(() => null as any)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const jobText = String(body?.job || body?.job_description || body?.jobText || "").trim()
    if (!jobText) {
      return withCorsJson(req, { error: "Missing job text" }, 400)
    }

    // User-provided job title and company name are REQUIRED. Extractor-
    // based title/company detection has been ~0% accurate across Lily's
    // 5-case test batch (section headers captured, bullets mistaken for
    // titles, "About Us" boilerplate leaking into company name). Rather
    // than keep patching the extractor, the frontend always asks the
    // user for both fields and the API rejects requests that omit them.
    // Clamped to 200 chars to bound storage.
    const userJobTitle = String(body?.job_title || "").trim().slice(0, 200)
    const userCompanyName = String(body?.company_name || "").trim().slice(0, 200)
    const userJobUrl = String(body?.job_url || "").trim().slice(0, 2000) || null
    if (!userJobTitle) {
      return withCorsJson(req, { error: "job_title is required" }, 400)
    }
    if (!userCompanyName) {
      return withCorsJson(req, { error: "company_name is required" }, 400)
    }

    const mode = String(body?.mode || "live")
    const debugFlag = Boolean(body?.debug)

    const bypass = isBypassAllowed(req)

    /* ------------------------------
     * BYPASS path (local only)
     * ------------------------------ */
    if (bypass) {
      const profileText = String(body?.profileText || body?.profile || "").trim()
      if (!profileText) {
        return withCorsJson(req, { error: "Missing profileText (or profile) for bypass mode" }, 400)
      }

      console.log("[jobfit/route] bypass evaluate", {
        mode,
        jobLen: jobText.length,
        profileLen: profileText.length,
      })

      const raw = await runJobFit({
        profileText,
        jobText,
        mode: mode || "test",
        debug: debugFlag,
      } as any)

      const result = enforceClientFacingRules(raw as any)

      return withCorsJson(req, {
        ...(result as any),
        jobfit_logic_version: JOBFIT_LOGIC_VERSION,
        reused: false,
        debug: {
          ...(result as any)?.debug,
          bypass: true,
          ts,
        },
      })
    }

    /* ------------------------------
     * NORMAL path (requires bearer)
     * ------------------------------ */
    const authed = await getAuthedProfileText(req as any)
    const profileId = (authed as any)?.profileId || (authed as any)?.profile_id || (authed as any)?.userId || MISSING

    // Warn loudly in logs if we can't identify this user — helps catch future contamination
    if (profileId === MISSING) {
      console.warn("[jobfit/route] WARNING: profileId resolved to MISSING — cache disabled for this request. Check getAuthedProfileText return shape.", {
        authedKeys: authed ? Object.keys(authed as any) : [],
      })
    }

    const forceFromQuery = (() => {
      try {
        const url = new URL(req.url)
        const v = url.searchParams.get("force")
        return v === "1" || v === "true"
      } catch {
        return false
      }
    })()

    const forceFromBody = body?.force === true || body?.force_rerun === true
    const forceRerun = forceFromQuery || forceFromBody

    const supabase = await getSupabaseAdmin()

    // SAFETY: never serve cached results if we don't have a real profile identity.
    // If profileId is MISSING, a cache hit could return a different user's result.
    const hasRealProfileId = profileId && profileId !== MISSING

    const personaId = String(body?.persona_id || "").trim() || null

    if (!hasRealProfileId || !supabase) {
      return withCorsJson(req, { error: "Unauthorized: missing bearer token" }, 401)
    }

    // Profile assembly (load client_profiles + optional persona, build
    // effectiveProfileText and profileOverrides) is delegated to the shared
    // pipeline helper so coach and client paths stay in sync.
    const assembled = await assembleProfileForScoring({
      clientProfileId: profileId,
      personaId,
      supabase,
    })

    // Preserve the legacy escape hatch: if the caller supplies an explicit
    // profileOverrides blob, use it instead of the derived one. This path is
    // used by internal regression tooling; normal clients leave it null.
    const bodyProfileOverrides = (body as any)?.profileOverrides
    if (bodyProfileOverrides != null) {
      assembled.profileOverrides = bodyProfileOverrides
    }

    if (!assembled.effectiveProfileText) {
      return withCorsJson(req, { error: "Unauthorized: missing bearer token or profile text" }, 401)
    }

    const { fingerprint_hash, fingerprint_code } = computeJobFitFingerprint({
      jobText,
      clientProfileId: profileId,
      effectiveProfileText: assembled.effectiveProfileText,
      profileOverrides: assembled.profileOverrides,
    })

    console.log("[jobfit/route] PRE-CACHE-CHECK:", { hasSupabase: !!supabase, forceRerun, hasRealProfileId, profileId, fingerprint_hash: fingerprint_hash?.slice(0, 12) })

    if (supabase && !forceRerun && hasRealProfileId) {
      try {
        const { data: existingRun } = await supabase
          .from("jobfit_runs")
          .select("result_json, verdict, fingerprint_hash, created_at")
          .eq("client_profile_id", profileId)
          .eq("fingerprint_hash", fingerprint_hash)
          .maybeSingle()

        console.log("[jobfit/route] CACHE-RESULT:", { cacheHit: !!existingRun?.result_json, hasRun: !!existingRun })

        if (existingRun?.result_json) {
          const cleaned = enforceClientFacingRules(existingRun.result_json as any)
          // Backfill jobTitle/companyName on cached results that predate the extraction
          if (cleaned?.job_signals && cleaned.job_signals.jobTitle === undefined) {
            const backfill = extractJobSignals(jobText)
            cleaned.job_signals.jobTitle = backfill.jobTitle
            cleaned.job_signals.companyName = backfill.companyName
          }

          // Apply user-provided overrides on cache hits too, so a user who
          // corrects the title/company on a resubmit sees the fix even when
          // the scoring result itself is served from cache.
          if (userJobTitle || userCompanyName) {
            if (!cleaned.job_signals) (cleaned as any).job_signals = {}
            if (userJobTitle) (cleaned as any).job_signals.jobTitle = userJobTitle
            if (userCompanyName) (cleaned as any).job_signals.companyName = userCompanyName
          }

          // Ensure a signal_application exists even on cache hits
          try {
            let cachedCompany = String(cleaned?.job_signals?.companyName || "").trim()
            let cachedTitle = String(cleaned?.job_signals?.jobTitle || "").trim()
            const cachedLocation = String(cleaned?.job_signals?.location?.city || "").trim()
            const cachedTitleFromUser = Boolean(userJobTitle)
            const cachedCompanyFromUser = Boolean(userCompanyName)
            if (!cachedTitleFromUser) {
              cachedTitle = cachedTitle
                .replace(
                  /^(?:position\s+title|job\s+title|job\s+position|role\s+title|title|position|role|job)\s*[:\-–—]\s*/i,
                  ""
                )
                .trim()
            }
            if (!cachedCompanyFromUser) {
              cachedCompany = cachedCompany
                .replace(
                  /^(?:company\s+name|employer\s+name|company|employer|organization|organisation)\s*[:\-–—]\s*/i,
                  ""
                )
                .trim()
            }
            const isGarbageCached = (s: string) => {
              if (!s) return true
              const t = s.trim().toLowerCase()
              if (/^(position|about|overview|description|summary|responsibilities|qualifications|requirements|who we are|company description|job description|role description)$/i.test(t)) return true
              if (/^about the (job|role|position|company|team)$/i.test(t)) return true
              if (/^recruiting for/i.test(t)) return true
              if (/^(apply|posted|deadline|date|salary|location|remote|hybrid)\s*[:]/i.test(t)) return true
              return false
            }
            if (!cachedCompanyFromUser && isGarbageCached(cachedCompany)) cachedCompany = ""
            if (!cachedTitleFromUser && isGarbageCached(cachedTitle)) cachedTitle = ""

            let existingCachedApp: any = null
            if (cachedCompany) {
              const { data } = await supabase
                .from("signal_applications")
                .select("id")
                .eq("profile_id", profileId)
                .ilike("company_name", cachedCompany)
                .ilike("job_title", cachedTitle || "")
                .maybeSingle()
              existingCachedApp = data
            }

            if (!existingCachedApp?.id) {
              await supabase.from("signal_applications").insert({
                profile_id: profileId,
                company_name: cachedCompany || "(Unknown Company)",
                job_title: cachedTitle || "(Unknown Role)",
                location: cachedLocation || "",
                job_url: userJobUrl,
                signal_decision: String(cleaned?.decision || ""),
                signal_score: (cleaned as any)?.score ?? null,
                signal_run_at: new Date().toISOString(),
                persona_id: personaId || null,
                application_status: "saved",
                interest_level: 1,
              })
              console.log("[jobfit/route] created application from cache hit:", cachedCompany || "(unknown)", cachedTitle || "(unknown)")
            }
          } catch (appErr: any) {
            console.warn("[jobfit/route] cache-hit application create failed:", appErr?.message)
          }

          return withCorsJson(req, {
            ...(cleaned as any),
            fingerprint_code,
            fingerprint_hash,
            jobfit_logic_version: JOBFIT_LOGIC_VERSION,
            reused: true,
            debug: { ...(cleaned as any)?.debug, cache_hit: true },
          })
        }
      } catch (e: any) {
        console.warn("[jobfit/route] cache lookup failed:", e?.message || String(e))
      }
    }

    // Full scoring pipeline: runJobFit + V5 AI bullet generator +
    // enforceClientFacingRules. Shared with /api/coach/recommend-job so
    // both paths produce byte-identical output given the same inputs.
    const pipelineResult = await runJobFitForProfile({
      clientProfileId: profileId,
      personaId,
      jobText,
      jobTitle: userJobTitle,
      companyName: userCompanyName,
      jobUrl: userJobUrl,
      mode,
      debug: debugFlag,
      userId: (authed as any)?.userId,
      supabase,
      preassembled: assembled,
    })
    const result: any = pipelineResult
    const cover_letter_strategy = pipelineResult.cover_letter_strategy ?? null
    const profileVersionAtRun = pipelineResult.profileVersionAtRun
    const personaVersionAtRun = pipelineResult.personaVersionAtRun

    if (supabase && hasRealProfileId) {
      try {
        const { data: runRow, error: runInsertErr } = await supabase.from("jobfit_runs").insert({
          client_profile_id: profileId,
          job_url: userJobUrl,
          fingerprint_hash,
          fingerprint_code,
          verdict: String((result as any)?.decision ?? (result as any)?.verdict ?? "unknown"),
          result_json: result,
          job_description: jobText,
          persona_id: personaId || null,
          profile_version_at_run: profileVersionAtRun,
          persona_version_at_run: personaVersionAtRun,
        }).select("id").single()

        if (runInsertErr) {
          console.warn("[jobfit/route] jobfit_runs insert failed:", runInsertErr.message)
        }

        // Auto-create or update signal_applications
        const rawCompanyName = (result as any)?.job_signals?.companyName
        const rawJobTitle = (result as any)?.job_signals?.jobTitle
        const jobLocation = String((result as any)?.job_signals?.location?.city || "").trim()
        let companyName = String(rawCompanyName || "").trim()
        let jobTitle = String(rawJobTitle || "").trim()
        const runId = runRow?.id || null

        // User-provided values win unconditionally. If the caller supplied
        // job_title / company_name explicitly, trust them and skip the
        // prefix-cleaning and garbage-filter heuristics (those exist to
        // scrub bad extractor output, not to second-guess the user).
        const jobTitleFromUser = Boolean(userJobTitle)
        const companyNameFromUser = Boolean(userCompanyName)

        if (!jobTitleFromUser) {
          // Strip common label prefixes. The compound forms ("position
          // title", "job title") must come BEFORE the single-word forms
          // so the longest match wins — otherwise "Position Title: X"
          // would only strip "Position" and leave " Title: X" behind,
          // which then trips the garbage filter below.
          jobTitle = jobTitle
            .replace(
              /^(?:position\s+title|job\s+title|job\s+position|role\s+title|title|position|role|job)\s*[:\-–—]\s*/i,
              ""
            )
            .trim()
        }
        if (!companyNameFromUser) {
          companyName = companyName
            .replace(
              /^(?:company\s+name|employer\s+name|company|employer|organization|organisation)\s*[:\-–—]\s*/i,
              ""
            )
            .trim()
        }

        // Garbage filter — catches strings that ARE section headers, not
        // strings that happen to START with section-header words. The old
        // implementation used `\b` after the keyword, which false-positived
        // on legitimate titles like "Position Control Analyst". We now
        // require the entire trimmed string to equal a bare header, or
        // match one of the specific metadata-row patterns.
        // Only applied to extractor output, never to user-provided values.
        const isGarbage = (s: string) => {
          if (!s) return true
          const t = s.trim().toLowerCase()
          if (/^(position|about|overview|description|summary|responsibilities|qualifications|requirements|who we are|company description|job description|role description)$/i.test(t)) return true
          if (/^about the (job|role|position|company|team)$/i.test(t)) return true
          if (/^recruiting for/i.test(t)) return true
          // Metadata rows ("Apply:", "Posted: ...", "Salary: ..."), keyword
          // must be followed by colon to qualify — we don't want to kill
          // titles like "Remote Content Strategist".
          if (/^(apply|posted|deadline|date|salary|location|remote|hybrid)\s*[:]/i.test(t)) return true
          return false
        }
        if (!companyNameFromUser && isGarbage(companyName)) companyName = ""
        if (!jobTitleFromUser && isGarbage(jobTitle)) jobTitle = ""

        console.log("[jobfit/route] auto-application signals:", {
          rawCompanyName, rawJobTitle, companyName, jobTitle, runId, profileId,
          hasJobSignals: !!(result as any)?.job_signals,
          jobSignalKeys: (result as any)?.job_signals ? Object.keys((result as any).job_signals).slice(0, 15) : [],
        })

        if (runId) {
          let existingApp: any = null
          if (companyName) {
            const { data, error: lookupErr } = await supabase
              .from("signal_applications")
              .select("id")
              .eq("profile_id", profileId)
              .ilike("company_name", companyName)
              .ilike("job_title", jobTitle || "")
              .maybeSingle()

            if (lookupErr) {
              console.warn("[jobfit/route] application lookup failed:", lookupErr.message)
            }
            existingApp = data
          }

          if (existingApp?.id) {
            const { error: updateErr } = await supabase.from("signal_applications").update({
              signal_decision: String((result as any)?.decision || ""),
              signal_score: (result as any)?.score ?? null,
              signal_run_at: new Date().toISOString(),
              jobfit_run_id: runId,
              updated_at: new Date().toISOString(),
            }).eq("id", existingApp.id)

            if (updateErr) console.warn("[jobfit/route] application update failed:", updateErr.message)

            await supabase.from("jobfit_runs").update({
              application_id: existingApp.id,
            }).eq("id", runId)

            console.log("[jobfit/route] updated existing application:", existingApp.id)
          } else {
            const { data: newApp, error: createErr } = await supabase.from("signal_applications").insert({
              profile_id: profileId,
              company_name: companyName || "(Unknown Company)",
              job_title: jobTitle || "(Unknown Role)",
              location: jobLocation || "",
              job_url: userJobUrl,
              signal_decision: String((result as any)?.decision || ""),
              signal_score: (result as any)?.score ?? null,
              signal_run_at: new Date().toISOString(),
              jobfit_run_id: runId,
              persona_id: personaId || null,
              application_status: "saved",
              interest_level: 1,
            }).select("id").single()

            if (createErr) {
              console.error("[jobfit/route] application create FAILED:", createErr.message, createErr.details, createErr.hint)
            } else {
              console.log("[jobfit/route] created new application:", newApp?.id)
            }

            if (newApp?.id) {
              await supabase.from("jobfit_runs").update({
                application_id: newApp.id,
              }).eq("id", runId)
            }
          }
        } else {
          console.log("[jobfit/route] skipping auto-application:", { companyName: companyName || "(empty)", runId: runId || "(null)" })
        }
      } catch (e: any) {
        console.warn("[jobfit/route] cache insert failed:", e?.message || String(e))
      }
    }

    // Track successful run — use profileId as session_id for dedup
    // TODO(analytics-phase-2): replace with analytics_events insert per docs/signal-analytics-spec.md
    // Previous behavior: INSERT into jobfit_page_views with the payload below
    console.log('[analytics:deferred]', {
      call_site: 'app/api/jobfit/route.ts:643',
      would_have_written: {
        session_id: String(profileId || crypto.randomUUID()),
        page_name: "jobfit_full_run",
        page_path: "/api/jobfit",
        referrer: null,
      },
    })

    return withCorsJson(req, {
      ...(result as any),
      fingerprint_code,
      fingerprint_hash,
      jobfit_logic_version: JOBFIT_LOGIC_VERSION,
      reused: false,
      cover_letter_strategy: cover_letter_strategy ?? undefined,
      debug: { ...(result as any)?.debug, cache_hit: false },
    })
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[jobfit/route] POST error:", err)
    }
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()
    const status = lower.includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { error: "JobFit failed", detail }, status)
  }
}