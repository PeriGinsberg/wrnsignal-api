import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { corsOptionsResponse } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MISSING = "__MISSING__"
const JOBFIT_PROMPT_VERSION = "jobfit_v1_2026_02_07"
const MODEL_ID = "current"

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
 * Basic CORS JSON responder
 */
function corsJson(req: Request, body: any, status = 200) {
  const origin = req.headers.get("origin") || "*"
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
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
 * Build JobFit fingerprint
 */
function buildJobFitFingerprint(payload: any) {
  const normalized = normalize(payload)
  const canonical = JSON.stringify(normalized)

  const fingerprint_hash = crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")

  const fingerprint_code =
    "JF-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

/**
 * Run JobFit for an authenticated user, with caching by fingerprint.
 */
export async function POST(req: Request) {
  try {
    // Auth + stored profile (server-side, user-bound)
    const { profileId, profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()

    if (!jobText) {
      return corsJson(req, { error: "Missing job" }, 400)
    }

    // Fingerprint inputs used for evaluation (job + profile + system pins)
    const fingerprintPayload = {
      job: { text: jobText || MISSING },
      profile: { id: profileId || MISSING, text: profileText || MISSING },
      system: {
        jobfit_prompt_version: JOBFIT_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_hash, fingerprint_code } =
      buildJobFitFingerprint(fingerprintPayload)

    // 1) Lookup existing run
    const { data: existingRun, error: findErr } = await supabaseAdmin
      .from("jobfit_runs")
      .select("result_json, verdict, fingerprint_code, fingerprint_hash, created_at")
      .eq("client_profile_id", profileId)
      .eq("fingerprint_hash", fingerprint_hash)
      .maybeSingle()

    if (findErr) {
      // If lookup fails, we can still proceed with a fresh run (don’t block user).
      // Return will be uncached.
      console.warn("jobfit_runs lookup failed:", findErr.message)
    }

    if (existingRun?.result_json) {
      return corsJson(req, {
        ...(existingRun.result_json as any),
        fingerprint_code,
        fingerprint_hash,
        reused: true,
      })
    }

    // 2) Run JobFit (GPT)
    const result = await runJobFit({
      profileText,
      jobText,
    })

    // 3) Store result (best effort)
    const toStore = {
      client_profile_id: profileId,
      job_url: null,
      fingerprint_hash,
      fingerprint_code,
      verdict: String((result as any)?.decision ?? (result as any)?.verdict ?? "unknown"),
      result_json: result,
    }

    const { error: insertErr } = await supabaseAdmin
      .from("jobfit_runs")
      .insert(toStore)

    if (insertErr) {
      console.warn("jobfit_runs insert failed:", insertErr.message)
    }

    return corsJson(req, {
      ...result,
      fingerprint_code,
      fingerprint_hash,
      reused: false,
    })
  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()

    const status =
      lower.includes("unauthorized") ? 401 :
      lower.includes("profile not found") ? 404 :
      lower.includes("access disabled") ? 403 :
      500

    return corsJson(req, { error: "JobFit failed", detail }, status)
  }
}
