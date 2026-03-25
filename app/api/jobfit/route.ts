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
const profileId = (authed as any)?.profileId || (authed as any)?.profile_id || (authed as any)?.userId || MISSING

    if (!profileText) {
      return withCorsJson(req, { error: "Unauthorized: missing bearer token or profile text" }, 401)
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

    let profileOverrides: any = body?.profileOverrides ?? null
    if (!profileOverrides) {
      try {
        const mod = await import("../_lib/jobfitProfileAdapter")
        if (typeof (mod as any).mapClientProfileToOverrides === "function") {
          profileOverrides = (mod as any).mapClientProfileToOverrides({
            profileText,
            profileStructured: (body as any)?.profileStructured ?? null,
            targetRoles: (body as any)?.targetRoles ?? null,
            preferredLocations: (body as any)?.preferredLocations ?? null,
          })
        }
      } catch {
        profileOverrides = null
      }
    }

    const fpPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING, overrides: profileOverrides || MISSING },
      system: { jobfit_logic_version: JOBFIT_LOGIC_VERSION },
    }
    const { fingerprint_hash, fingerprint_code } = buildFingerprint(fpPayload)

    const supabase = await getSupabaseAdmin()

    if (supabase && !forceRerun) {
      try {
        const { data: existingRun } = await supabase
          .from("jobfit_runs")
          .select("result_json, verdict, fingerprint_hash, created_at")
          .eq("client_profile_id", profileId)
          .eq("fingerprint_hash", fingerprint_hash)
          .maybeSingle()

        if (existingRun?.result_json) {
          const cleaned = enforceClientFacingRules(existingRun.result_json as any)
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
    profileText: resumeText || profileText,
    jobText,
    profileOverrides,
    userId: (authed as any)?.userId,
    mode,
    debug: debugFlag,
} as any)

    const result = enforceClientFacingRules(raw as any)

    if (supabase) {
      try {
        await supabase.from("jobfit_runs").insert({
          client_profile_id: profileId,
          job_url: null,
          fingerprint_hash,
          fingerprint_code,
          verdict: String((result as any)?.decision ?? (result as any)?.verdict ?? "unknown"),
          result_json: result,
        })
      } catch (e: any) {
        console.warn("[jobfit/route] cache insert failed:", e?.message || String(e))
      }
    }

    return withCorsJson(req, {
      ...(result as any),
      fingerprint_code,
      fingerprint_hash,
      jobfit_logic_version: JOBFIT_LOGIC_VERSION,
      reused: false,
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