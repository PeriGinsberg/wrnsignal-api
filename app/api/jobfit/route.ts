// FILE: app/api/jobfit/route.ts

import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { mapClientProfileToOverrides } from "../_lib/jobfitProfileAdapter"
import { extractProfileV4, PROFILE_V4_STAMP } from "../_v4/extractProfileV4"

import { TAXONOMY_V4_STAMP } from "../_v4/taxonomy"
import { TYPES_V4_STAMP } from "../_v4/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MISSING = "__MISSING__"
const JOBFIT_PROMPT_VERSION = "jobfit_v1_2026_02_07"
const JOBFIT_LOGIC_VERSION = "rules_v3_2026_02_24"
const MODEL_ID = "current"

const ROUTE_JOBFIT_STAMP = "ROUTE_JOBFIT_STAMP__V4_PROFILE_INTEGRATION__V1"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

/**
 * CORS preflight
 */
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * Normalize values for deterministic fingerprinting
 */
function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (cleaned === "") return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }

  if (Array.isArray(value)) {
    return value.map(normalize).sort()
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, key) => {
        const v = value[key]
        if (v !== null && v !== undefined) {
          acc[key] = normalize(v)
        }
        return acc
      }, {})
  }

  return value
}

/**
 * Hash helpers for debug visibility
 */
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}

function hash16(s: string): string {
  return sha256Hex(s).slice(0, 16)
}

/**
 * Build JobFit fingerprint
 */
function buildJobFitFingerprint(payload: any) {
  const normalized = normalize(payload)
  const canonical = JSON.stringify(normalized)

  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const fingerprint_code = "JF-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

/**
 * Enforce client-facing output rules (even for cached results).
 * Rule: if gate_triggered.type === "force_pass", then why_codes=[], bullets=[]
 * and we only show pass reason + risks.
 */
function enforceClientFacingRules(result: any) {
  const gateType = result?.gate_triggered?.type
  if (gateType !== "force_pass") return result

  return {
    ...result,
    decision: "Pass",
    icon: result?.icon ?? "⛔",
    bullets: [],
    why_codes: [],
    // keep risk_codes and risk_flags if present
    next_step: "Pass. Do not apply. Put that effort into a better-fit role.",
  }
}

/**
 * Run JobFit for an authenticated user, with caching by fingerprint.
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const forceFromQuery = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true"

    const { profileId, profileText } = await getAuthedProfileText(req)

    // Pull structured profile fields for deterministic overrides
    const { data: profileRowDb, error: profileLookupError } = await supabaseAdmin
      .from("client_profiles")
      .select("id, profile_structured, target_roles, preferred_locations, risk_overrides")
      .eq("id", profileId)
      .maybeSingle()

    if (profileLookupError || !profileRowDb) {
      return withCorsJson(req, { error: "Profile lookup failed" }, 404)
    }

    // Parse request body
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    const jobText = String(body?.job || "").trim()
    if (!jobText) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const forceFromBody = body?.force_rerun === true || body?.force === true
    const forceRerun = forceFromQuery || forceFromBody

    // Ensure we have a structured profile (compute V4 deterministically if missing)
    const hadStructuredInDb = Boolean((profileRowDb as any)?.profile_structured)
    let profileStructuredResolved = (profileRowDb as any)?.profile_structured ?? null

    if (!profileStructuredResolved) {
      profileStructuredResolved = extractProfileV4(profileText || "")

      // Best effort: persist so future runs are deterministic + fast
      const { error: upErr } = await supabaseAdmin
        .from("client_profiles")
        .update({ profile_structured: profileStructuredResolved })
        .eq("id", profileId)

      if (upErr) {
        console.warn("client_profiles update profile_structured failed:", upErr.message)
      }
    }
const extractedToolsTrue = Object.entries((profileStructuredResolved as any)?.tools ?? {})
  .filter(([, v]) => v === true)
  .map(([k]) => k)
  .sort()

    // Build structured overrides from profile row + resolved structured profile
    const profileOverrides = mapClientProfileToOverrides({
      profileText,
      profileStructured: profileStructuredResolved,
      targetRoles: (profileRowDb as any)?.target_roles ?? null,
      preferredLocations: (profileRowDb as any)?.preferred_locations ?? null,
    })

    // Fingerprint inputs used for evaluation (job + profile + overrides + system pins)
    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: {
        id: profileId || MISSING,
        text: profileText || MISSING,
        overrides: profileOverrides || MISSING,
        profile_structured: profileStructuredResolved || MISSING,
      },
      system: {
        jobfit_prompt_version: JOBFIT_PROMPT_VERSION,
        model_id: MODEL_ID,
        jobfit_logic_version: JOBFIT_LOGIC_VERSION,
        profile_v4_stamp: PROFILE_V4_STAMP,
        route_jobfit_stamp: ROUTE_JOBFIT_STAMP,
      },
    }

    const { fingerprint_hash, fingerprint_code } = buildJobFitFingerprint(fingerprintPayload)

    // Debug fields (kills the “same job illusion” + proves V4 integration is live)
    const debug = {
      route_jobfit_stamp: ROUTE_JOBFIT_STAMP,
      profile_v4_stamp: PROFILE_V4_STAMP,
      profile_structured_source: hadStructuredInDb ? "db" : "computed_v4",

      job_text_len: jobText.length,
      profile_text_len: (profileText || "").length,
      job_text_hash16: hash16(jobText),
      profile_text_hash16: hash16(profileText || ""),
      fingerprint_hash16: fingerprint_hash.slice(0, 16),
      cache_key: `${fingerprint_hash}::${JOBFIT_LOGIC_VERSION}`,
      cache_bypassed: forceRerun,
extracted_tools_true: extractedToolsTrue,
taxonomy_v4_stamp: TAXONOMY_V4_STAMP,
types_v4_stamp: TYPES_V4_STAMP,
    }

    // 1) Lookup existing run unless forced
    if (!forceRerun) {
      const { data: existingRun, error: findErr } = await supabaseAdmin
        .from("jobfit_runs")
        .select("result_json, verdict, fingerprint_code, fingerprint_hash, created_at")
        .eq("client_profile_id", profileId)
        .eq("fingerprint_hash", fingerprint_hash)
        .maybeSingle()

      if (findErr) {
        console.warn("jobfit_runs lookup failed:", findErr.message)
      }

      if (existingRun?.result_json) {
        const cleaned = enforceClientFacingRules(existingRun.result_json as any)
        return withCorsJson(req, {
          ...(cleaned as any),
          fingerprint_code,
          fingerprint_hash,
          jobfit_logic_version: JOBFIT_LOGIC_VERSION,
          reused: true,
          debug: { ...debug, cache_hit: true },
        })
      }
    }

    // 2) Run JobFit (deterministic engine + bullet layer via wrapper)
    const resultRaw = await runJobFit({
      profileText,
      jobText,
      profileOverrides,
    })

    const result = enforceClientFacingRules(resultRaw as any)

    // 3) Store result (best effort)
    // If cache is bypassed and this fingerprint already exists, insert will hit the unique constraint.
    // That is fine for testing: we ignore the insert error and still return the fresh result.
    const toStore = {
      client_profile_id: profileId,
      job_url: null,
      fingerprint_hash,
      fingerprint_code,
      verdict: String((result as any)?.decision ?? (result as any)?.verdict ?? "unknown"),
      result_json: result,
    }

    const { error: insertErr } = await supabaseAdmin.from("jobfit_runs").insert(toStore)
    if (insertErr) {
      console.warn("jobfit_runs insert failed:", insertErr.message)
    }

    return withCorsJson(req, {
      ...(result as any),
      fingerprint_code,
      fingerprint_hash,
      jobfit_logic_version: JOBFIT_LOGIC_VERSION,
      reused: false,
      debug: { ...debug, cache_hit: false },
    })
  } catch (err: any) {
    // Never swallow stack traces silently in dev
    if (process.env.NODE_ENV !== "production") {
      console.error("JobFit POST error:", err)
    }

    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()

    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("profile not found")
        ? 404
        : lower.includes("access disabled")
          ? 403
          : 500

    return withCorsJson(req, { error: "JobFit failed", detail }, status)
  }
}