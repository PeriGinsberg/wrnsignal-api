// app/api/internal/pipeline/cost-report/route.ts
//
// Mondays 13:00 UTC: last week's job sourcing cost by step, month to date,
// projected month total, and SearchApi searches used of the plan
// (lib/pipeline/cost.ts). Only where the pipeline is enabled, so staging does
// not send a second report about dev.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runWeeklyReport } from "@/lib/pipeline/cost"
import { sendPipelineEmail } from "@/lib/email/sendPipelineAlert"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    const res = await runWeeklyReport(getSupabaseAdmin(), { apiKey: process.env.SEARCHAPI_KEY, send: sendPipelineEmail })
    return Response.json({ ok: true, environment, subject: res.subject })
  } catch (err: any) {
    console.error("[pipeline-cost-report] failed:", err?.message || err)
    return Response.json({ ok: false, environment, error: String(err?.message || err).slice(0, 500) }, { status: 500 })
  }
}
