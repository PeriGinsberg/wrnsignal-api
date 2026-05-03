// FROZEN: legacy jobfit_only trial lookup, sunset 2026-05-03. Do not extend.
//
// This endpoint was the existence-check the Framer dashboard used to
// flip a user into accessMode === "jobfit_only" — given an email, it
// returned whether that email had a row in jobfit_users with credits.
// The redesigned trial flow doesn't have a multi-shot dashboard; trial
// users get a one-shot result page only, so this lookup is no longer
// needed.
//
// Returns 410 Gone for any caller. Delete after at least 30 days of
// confirmed zero traffic in production logs.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

const DEPRECATED_RESPONSE = {
  error: "endpoint_deprecated",
  message:
    "Legacy trial lookup is closed. Visit https://wrnsignal.workforcereadynow.com/signal/job-analysis to start a free SIGNAL analysis.",
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  return withCorsJson(req, DEPRECATED_RESPONSE, 410)
}

export async function GET(req: NextRequest) {
  return withCorsJson(req, DEPRECATED_RESPONSE, 410)
}
