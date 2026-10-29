// app/api/internal/pipeline/tick/route.ts
//
// The nightly pipeline, one step per call: Google Jobs, enrich, match, link
// check (lib/pipeline/tick.ts). Cron every 15 minutes, 05:00-07:45 UTC, after
// the ATS sweeps. A call with nothing left to do returns done.
//
// OFF UNLESS PIPELINE_ENABLED=true. The staging project runs the same crons
// against the dev database, and Google Jobs searches spend the SearchApi plan
// that dev and prod share. The 09:00 watchdog reports a disabled pipeline
// wherever clients are waiting on it.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runTick } from "@/lib/pipeline/tick"
import { sendPipelineEmail } from "@/lib/email/sendPipelineAlert"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Steps stop starting new work at 640s (TICK_BUDGET_MS); the rest is for scans and writes.
export const maxDuration = 800

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
    const res = await runTick(getSupabaseAdmin(), { environment, send: sendPipelineEmail })
    return Response.json({ ok: true, environment, ...res })
  } catch (err: any) {
    console.error("[pipeline-tick] failed:", err?.message || err)
    return Response.json({ ok: false, environment, error: String(err?.message || err).slice(0, 500) }, { status: 500 })
  }
}
