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
import { mapClientProfileToOverrides } from "../_lib/jobfitProfileAdapter"
import { extractProfileV4, PROFILE_V4_STAMP } from "../_v4/extractProfileV4"
import { RENDERER_V4_STAMP } from "../jobfit/deterministicBulletRendererV4"
import { extractJobSignals } from "../jobfit/extract"
import { enforceClientFacingRules } from "./enforceClientFacingRules"

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

/* ----------------------------------
 * Fingerprint helpers (best-effort)
 * ---------------------------------- */
const MISSING = "__MISSING__"
const JOBFIT_LOGIC_VERSION = process.env.JOBFIT_LOGIC_VERSION || "rules_local_dev"

function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (!cleaned) return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }
  if (Array.isArray(value)) return value.map(normalize).sort()
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        const v = value[k]
        if (v !== null && v !== undefined) acc[k] = normalize(v)
        return acc
      }, {})
  }
  return value
}

function buildFingerprint(payload: any) {
  const canonical = JSON.stringify(normalize(payload))
  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const fingerprint_code = "JF-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()
  return { fingerprint_hash, fingerprint_code }
}

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
    const profileText = String((authed as any)?.profileText || "").trim()
    const resumeText = String((authed as any)?.resumeText || "").trim()
    const profileStructured = (authed as any)?.profileStructured ?? null
    const targetRoles = (authed as any)?.targetRoles ?? null
    const preferredLocations = (authed as any)?.targetLocations ?? null
    const profileId = (authed as any)?.profileId || (authed as any)?.profile_id || (authed as any)?.userId || MISSING

    // Warn loudly in logs if we can't identify this user — helps catch future contamination
    if (profileId === MISSING) {
      console.warn("[jobfit/route] WARNING: profileId resolved to MISSING — cache disabled for this request. Check getAuthedProfileText return shape.", {
        hasProfileText: !!profileText,
        hasResumeText: !!resumeText,
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

    // ── Persona support (optional) ──────────────────────────────────
    const personaId = String(body?.persona_id || "").trim() || null
    let personaResumeText: string | null = null
    let profileVersionAtRun: number | null = null
    let personaVersionAtRun: number | null = null

    if (personaId && hasRealProfileId && supabase) {
      const { data: persona, error: personaErr } = await supabase
        .from("client_personas")
        .select("resume_text, persona_version, profile_id")
        .eq("id", personaId)
        .maybeSingle()

      if (personaErr) console.warn("[jobfit/route] persona lookup failed:", personaErr.message)

      if (persona && persona.profile_id === profileId) {
        personaResumeText = String(persona.resume_text || "").trim()
        personaVersionAtRun = persona.persona_version ?? 1
      } else if (persona) {
        return withCorsJson(req, { error: "Persona does not belong to this profile" }, 403)
      }

      const { data: pv } = await supabase
        .from("client_profiles")
        .select("profile_version")
        .eq("id", profileId)
        .maybeSingle()
      profileVersionAtRun = pv?.profile_version ?? 1
    }
    // ────────────────────────────────────────────────────────────────

    // Use resume_text as primary profile source — fall back to profile_text
    // If persona was specified and found, splice its resume into the canonical profile blob
    let effectiveProfileText: string
    if (personaResumeText && profileText) {
      effectiveProfileText = profileText.replace(
        /(Resume:\n)([\s\S]*?)(\n[A-Z][a-z]|$)/,
        `$1${personaResumeText}$3`
      )
    } else {
      effectiveProfileText = personaResumeText || resumeText || profileText
    }

    if (!effectiveProfileText) {
      return withCorsJson(req, { error: "Unauthorized: missing bearer token or profile text" }, 401)
    }

    let profileOverrides: any = body?.profileOverrides ?? null
    if (!profileOverrides) {
      try {
        const mod = await import("../_lib/jobfitProfileAdapter")
        if (typeof (mod as any).mapClientProfileToOverrides === "function") {
          profileOverrides = (mod as any).mapClientProfileToOverrides({
            profileText: profileText || effectiveProfileText,
            profileStructured: profileStructured,
            targetRoles: targetRoles,
            preferredLocations: preferredLocations,
          })
        }
      } catch {
        profileOverrides = null
      }
    }

    const fpPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: effectiveProfileText || MISSING, overrides: profileOverrides || MISSING },
      system: { jobfit_logic_version: JOBFIT_LOGIC_VERSION },
    }
    const { fingerprint_hash, fingerprint_code } = buildFingerprint(fpPayload)

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

          // Ensure a signal_application exists even on cache hits
          try {
            let cachedCompany = String(cleaned?.job_signals?.companyName || "").trim()
            let cachedTitle = String(cleaned?.job_signals?.jobTitle || "").trim()
            const cachedLocation = String(cleaned?.job_signals?.location?.city || "").trim()
            cachedTitle = cachedTitle.replace(/^(?:Title|Position|Role|Job Title)\s*[:]\s*/i, "").trim()
            cachedCompany = cachedCompany.replace(/^(?:Company|Employer|Organization)\s*[:]\s*/i, "").trim()
            const isGarbageCached = (s: string) => !s || /^(position|about|overview|description|summary|responsibilities|qualifications|requirements|who we are|company description|job description|role description)\b/i.test(s) || /\babout the (job|role|position|company|team)\b/i.test(s) || /^recruiting for/i.test(s) || /^(apply|posted|deadline|date|salary|location|remote|hybrid)\b/i.test(s)
            if (isGarbageCached(cachedCompany)) cachedCompany = ""
            if (isGarbageCached(cachedTitle)) cachedTitle = ""

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

    const raw = await runJobFit({
      profileText: effectiveProfileText,
      jobText,
      profileOverrides,
      userId: (authed as any)?.userId,
      mode,
      debug: debugFlag,
    } as any)

    // ── V5: replace bullets with AI-generated ones ──────────────────────────
    let cover_letter_strategy: any = null
    try {
      const { generateBulletsV5 } = await import("./bulletGeneratorV5")
      const v5 = await generateBulletsV5({
        ...(raw as any),
        profile_text: effectiveProfileText,
        job_text: jobText,
      })
      ;(raw as any).why = v5.why
      ;(raw as any).risk = v5.risk
      ;(raw as any).bullets = v5.why
      ;(raw as any).risk_bullets = v5.risk
      ;(raw as any).why_structured = v5.why_structured
      ;(raw as any).risk_structured = v5.risk_structured
      ;(raw as any).debug = {
        ...(raw as any).debug,
        ...v5.renderer_debug,
      }
      cover_letter_strategy = v5.cover_letter_strategy
      console.log("[V5 bullet generator] success", {
        why_count: v5.why_structured.length,
        risk_count: v5.risk_structured.length,
        latency_ms: v5.renderer_debug.latency_ms,
      })
    } catch (err: any) {
      console.error("[V5 bullet generator] failed, falling back to V4:", err?.message || String(err))
    }
    // ────────────────────────────────────────────────────────────────────────

    const result = enforceClientFacingRules(raw as any)

    if (supabase && hasRealProfileId) {
      try {
        const { data: runRow, error: runInsertErr } = await supabase.from("jobfit_runs").insert({
          client_profile_id: profileId,
          job_url: null,
          fingerprint_hash,
          fingerprint_code,
          verdict: String((result as any)?.decision ?? (result as any)?.verdict ?? "unknown"),
          result_json: result,
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

        // Clean common prefixes from extracted values
        jobTitle = jobTitle.replace(/^(?:Title|Position|Role|Job Title)\s*[:]\s*/i, "").trim()
        companyName = companyName.replace(/^(?:Company|Employer|Organization)\s*[:]\s*/i, "").trim()

        // Clean extracted values that look like section headers, not real names
        const isGarbage = (s: string) => !s || /^(position|about|overview|description|summary|responsibilities|qualifications|requirements|who we are|company description|job description|role description)\b/i.test(s) || /\babout the (job|role|position|company|team)\b/i.test(s) || /^recruiting for/i.test(s) || /^(apply|posted|deadline|date|salary|location|remote|hybrid)\b/i.test(s)
        if (isGarbage(companyName)) companyName = ""
        if (isGarbage(jobTitle)) jobTitle = ""

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

    // Track successful run
    try {
      const sb = await getSupabaseAdmin()
      if (sb) {
        await sb.from("jobfit_page_views").insert({
          session_id: crypto.randomUUID(),
          page_name: "jobfit_full_run",
          page_path: "/api/jobfit",
          referrer: null,
        })
      }
    } catch {}

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