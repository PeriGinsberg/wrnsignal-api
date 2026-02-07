/**
 * Jobfit Function
 */
import crypto from "crypto"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"


const MISSING = "__MISSING__"
const JOBFIT_PROMPT_VERSION = "jobfit_v1_2026_02_07"
const MODEL_ID = "current"

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
    "JF-" + parseInt(fingerprint_hash.slice(0, 10), 16)
      .toString(36)
      .toUpperCase()

  return { fingerprint_hash, fingerprint_code }
}

/**
 * Run JobFit for an authenticated user
 */
export async function POST(req: Request) {
  try {
    // Auth + stored profile (user-bound, server-side)
    const { profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()

    if (!jobText) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    // Build fingerprint payload (evaluation inputs only)
    const fingerprintPayload = {
      job: {
        text: jobText || MISSING,
      },
      profile: {
        text: profileText || MISSING,
      },
      system: {
        jobfit_prompt_version: JOBFIT_PROMPT_VERSION,
        model_id: MODEL_ID,
      },
    }

    const { fingerprint_code } =
      buildJobFitFingerprint(fingerprintPayload)

    // Run JobFit (behavior unchanged)
    const result = await runJobFit({
      profileText,
      jobText,
    })
return withCorsJson(
  req,
  {
    ...result,
    fingerprint_code,
    __debug_jobfit_route: "v1_fingerprint_enabled",
  },
  200
)  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = detail.toLowerCase()

    const status =
      lower.includes("unauthorized") ? 401 :
      lower.includes("profile not found") ? 404 :
      lower.includes("access disabled") ? 403 :
      500

    return withCorsJson(req, { error: "JobFit failed", detail }, status)
  }
}
