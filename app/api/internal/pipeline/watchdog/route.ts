// app/api/internal/pipeline/watchdog/route.ts
//
// 09:00 UTC: emails if any step of last night's pipeline was skipped, is stuck,
// or ran out of time with work left; then the cost pace check
// (lib/pipeline/watchdog.ts). Runs whether or not the pipeline is enabled:
// a disabled pipeline with clients waiting is itself reported.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runWatchdog } from "@/lib/pipeline/watchdog"
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
  const supabase = getSupabaseAdmin()
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"
  const { error: probe } = await supabase.from("pipeline_runs").select("id").limit(1)
  if (probe?.code === "PGRST205") {
    return Response.json({ ok: true, skipped: "pipeline tables absent in this environment", environment })
  }
  try {
    const res = await runWatchdog(supabase, { enabled: process.env.PIPELINE_ENABLED === "true", environment, send: sendPipelineEmail })
    return Response.json({ ok: true, environment, ...res })
  } catch (err: any) {
    console.error("[pipeline-watchdog] failed:", err?.message || err)
    return Response.json({ ok: false, environment, error: String(err?.message || err).slice(0, 500) }, { status: 500 })
  }
}
