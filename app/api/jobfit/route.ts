import crypto from "crypto"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

const MISSING = "__MISSING__"
const JOBFIT_PROMPT_VERSION = "jobfit_v1_2026_02_07"

/**
 * CORS preflight
 * This must return 204 with the correct headers (no redirects).
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

  const hash = crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")

  const code =
    "JF-" + parseInt(hash.slice(0, 10), 16).toString(36).toUpperCase()

  return {
    fingerprint_hash: hash,
    fingerprint_code: code,
  }
}

/**
 * Run JobFit for an authenticated user.
 */
export async function POST(req: Request) {
  try {
    // Auth + stored profile
    const { profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const jobText = String(body?.job || "").trim()

    if (!jobText) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    // --- NEW: build fingerprint payload ---
    const fingerprintPayload = {
      job: {
        text: jobText || MISSING,
      },
      profile: {
        profile_text: profileText || MISSING,
      },
      system: {
        jobfit_prompt_version: JOBFIT_PROMPT_VERSION,
        model_id: "current", // replace with real model id if you expose it
      },
    }

    const { fingerprint_code } =
      buildJobFitFingerprint(fingerprintPayload)
    // --- END fingerprint ---

    const out = await runJobFit({
      profileText,
      jobText,
    })

    return withCorsJson(
      req,
      {
        ...out,
        fingerprint_code,
      },
      200
    )
  } catch (err: any) {
    const detail = err?.message || String(err)
    const lower = String(detail).toLowerCase()

    const status =
      lower.includes("unauthorized") ? 401 :
      lower.includes("profile not found") ? 404 :
      lower.includes("access disabled") ? 403 :
      500

    return withCorsJson(req, { error: "JobFit failed", detail }, status)
  }
}
