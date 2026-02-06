import { getAuthedProfileText } from "../../_lib/authProfile"
import { runJobFit } from "../../_lib/jobfitEvaluator"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"

/**
 * CORS preflight
 * This must return 204 with the correct headers (no redirects).
 */
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

/**
 * Run JobFit for an authenticated user.
 */
export async function POST(req: Request) {
  try {
    // Auth + stored profile
    const { profileText } = await getAuthedProfileText(req)

    const body = await req.json()
    const job = String(body?.job || "").trim()

    if (!job) {
      return withCorsJson(req, { error: "Missing job" }, 400)
    }

    const out = await runJobFit({
      profileText,
      jobText: job,
    })

    return withCorsJson(req, out, 200)
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



