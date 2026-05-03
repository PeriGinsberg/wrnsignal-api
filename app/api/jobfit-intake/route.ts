// FROZEN: legacy jobfit_only trial intake, sunset 2026-05-03. Do not extend.
//
// This endpoint accepted name + email + resume + intake fields from the
// old free-trial flow, creating jobfit_users and jobfit_profiles rows
// with credits_remaining = 3. The redesigned trial flow at
// /api/jobfit-run-trial is one-shot and accepts resume + JD + email in
// a single call, so this endpoint is permanently retired.
//
// Returns 410 Gone for any caller. Delete after at least 30 days of
// confirmed zero traffic in production logs.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

const DEPRECATED_RESPONSE = {
  error: "endpoint_deprecated",
  message:
    "Legacy trial intake is closed. Visit https://wrnsignal.workforcereadynow.com/signal/job-analysis to start a free SIGNAL analysis.",
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
