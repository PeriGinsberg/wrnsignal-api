// app/api/internal/ingest/staleness/route.ts
//
// Has ingest written anything in the last 36 hours?
//
// A SEPARATE ROUTE AND A SEPARATE CRON, not a step inside the sweep. The
// failure it catches is the sweep not running, and a check that only executes
// when the sweep executes can never fire. That is exactly how lane_results
// went dark for seventeen days: the only evidence was absence, and absence is
// not a signal until something looks for it.
//
// IT RUNS LATER IN THE MORNING than the sweep, so a sweep that is merely slow
// has finished before this asks. With the sweep at 03:00 and this at 09:00,
// the 36h threshold means a single missed night is reported the following
// morning rather than two days later.
//
// THIS ROUTE DOES NOT PING the dead-man's switch. It is the inner layer; the
// switch is the outer one, and a watchdog fed by the thing it watches is not a
// watchdog.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { checkStaleness, DEFAULT_THRESHOLD_HOURS } from "@/lib/ingest/staleness"

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

  const { error: probe } = await supabase.from("ingest_runs").select("source").limit(1)
  if (probe?.code === "PGRST205") {
    return Response.json({
      ok: true,
      skipped: "ingest tables absent in this environment",
      environment,
    })
  }

  const thresholdHours = Number(process.env.INGEST_STALE_HOURS ?? DEFAULT_THRESHOLD_HOURS)

  const res = await checkStaleness(supabase, { thresholdHours, environment })

  return Response.json({
    ok: true,
    environment,
    stale: res.stale,
    lastRunAt: res.lastRunAt,
    hoursSince: res.hoursSince === null ? null : Number(res.hoursSince.toFixed(2)),
    thresholdHours: res.thresholdHours,
    alerted: !!res.alert,
  })
}
