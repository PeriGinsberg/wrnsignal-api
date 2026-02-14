import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runJobFit } from "../_lib/jobfitEvaluator"

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
 * CORS
 *
 * Framer preview origins look like:
 *   https://project-<random>.framercanvas.com
 *
 * Your DEV site looks like:
 *   https://genuine-times-909123.framer.app
 *
 * Production might be:
 *   https://www.workforcereadynow.com
 *
 * Add any other domains you use here.
 */
const ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^https:\/\/project-[a-z0-9]+\.framercanvas\.com$/i,
  /^https:\/\/[a-z0-9-]+\.framer\.app$/i,
  /^https:\/\/www\.workforcereadynow\.com$/i,
  /^https:\/\/workforcereadynow\.com$/i,
]

function isAllowedOrigin(origin: string) {
  if (!origin) return false
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))
}

function corsHeaders(origin: string | null) {
  const h = new Headers()

  // Always vary so caches don’t serve the wrong allow-origin
  h.set("Vary", "Origin")

  // Only echo back allowed origins
  if (origin && isAllowedOrigin(origin)) {
    h.set("Access-Control-Allow-Origin", origin)
  }

  h.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization")

  // Optional: helps reduce preflight spam
  h.set("Access-Control-Max-Age", "86400")

  return h
}

function json(req: Request, body: any, status = 200) {
  const origin = req.headers.get("origin")
  const headers = corsHeaders(origin)
  headers.set("Content-Type", "application/json")
  return new Response(JSON.stringify(body), { status, headers })
}

function preflight(req: Request) {
  const origin = req.headers.get("origin")
  const headers = corsHeaders(origin)

  // If the origin is missing (server-to-server) or not allowed, return 204 anyway
  // but without allow-origin. Browser will block if it’s not allowed, which is what we want.
  return new Response(null, { status: 204, headers })
}

/**
 * CORS preflight
 */
export async function OPTIONS(req: Request) {
  return preflight(req)
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
  // Hard fail early if browser origin is present but not allowed
  // This prevents accidental open CORS in production.
  const origin = req.headers.get("origin")
  if (origin && !isAllowedOrigin(origin)) {
    return json(req, { error: "CORS blocked", detail: "Origin not allowed" }, 403)
  }

  try {
    // Auth + stored profile (server-side, user-bound)
    const { profileId, profileText } = await getAuthedProfileText(req)

    let body: any = null
    try {
      body = await req.json()
    } catch {
      return json(req, { error: "Invalid JSON body" }, 400)
    }

    const jobText = String(body?.job || "").trim()
    if (!jobText) return json(req, { error: "Missing job" }, 400)

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
      // Lookup failing should not block the user
      console.warn("jobfit_runs lookup failed:", findErr.message)
    }

    if (existingRun?.result_json) {
      return json(req, {
        ...(existingRun.result_json as any),
        fingerprint_code,
        fingerprint_hash,
        reused: true,
      })
    }

    // 2) Run JobFit (GPT)
    const result = await runJobFit({ profileText, jobText })

    // 3) Store result (best effort)
    const toStore = {
      client_profile_id: profileId,
      job_url: null,
      fingerprint_hash,
      fingerprint_code,
      verdict: String(
        (result as any)?.decision ?? (result as any)?.verdict ?? "unknown"
      ),
      result_json: result,
    }

    const { error: insertErr } = await supabaseAdmin
      .from("jobfit_runs")
      .insert(toStore)

    if (insertErr) {
      console.warn("jobfit_runs insert failed:", insertErr.message)
    }

    return json(req, {
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

    return json(req, { error: "JobFit failed", detail }, status)
  }
}
