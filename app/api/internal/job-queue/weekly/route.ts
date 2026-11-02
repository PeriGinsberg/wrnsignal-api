// app/api/internal/job-queue/weekly/route.ts
//
// Mondays 12:00 UTC: last week's Job Queue decisions -> the match-quality
// measure, refreshed judge examples, and Sonnet 5.5 criteria proposals, then
// one email linking to the proposals page (lib/match/weekly.ts). Only where the
// pipeline is enabled, as the cost report.
//
// ?propose=0 skips the proposals (no model calls).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runWeekly, weeklyEmail } from "@/lib/match/weekly"
import { sendPipelineEmail } from "@/lib/email/sendPipelineAlert"
import { getAppUrl } from "@/lib/urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"
  if (process.env.PIPELINE_ENABLED !== "true") {
    return Response.json({ ok: true, skipped: "PIPELINE_ENABLED is not true", environment })
  }
  try {
    const propose = new URL(req.url).searchParams.get("propose") !== "0"
    const r = await runWeekly(getSupabaseAdmin(), { propose })
    const { subject, text } = weeklyEmail(r, getAppUrl(req))
    await sendPipelineEmail(subject, text)
    return Response.json({ ok: true, environment, ...r })
  } catch (err: any) {
    console.error("[job-queue-weekly] failed:", err?.message || err)
    return Response.json({ ok: false, environment, error: String(err?.message || err).slice(0, 500) }, { status: 500 })
  }
}
