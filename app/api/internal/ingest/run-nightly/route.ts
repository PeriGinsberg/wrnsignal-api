// app/api/internal/ingest/run-nightly/route.ts
//
// The nightly ingest sweep: every active pair in ingest_pairs across every
// active board in ingest_boards, for every adapter this build knows.
//
// AUTH is the same Bearer CRON_SECRET the lane sweep uses. Same secret, same
// shape, so there is one thing to rotate rather than two.
//
// THE DEAD-MAN'S PING FIRES ONLY ON A CLEAN SWEEP, which is the whole point of
// a dead-man's switch: a run that alerted has already spoken for itself, and
// pinging after a failure would tell the external watchdog everything is fine
// while an alert sits in an inbox. Silence is the signal, so a bad run stays
// silent to the watchdog.
//
// IT USES ITS OWN PING URL, not the artifact monitor's. Two monitors sharing
// one Healthchecks check means either one can satisfy it, so the artifact
// monitor could go dark for a week and the ingest sweep's nightly ping would
// keep the check green. That is worse than having no switch, because it looks
// like coverage.
//
// PRODUCTION MAY LEGITIMATELY FAIL HERE. Vercel crons run on every project
// deploying this vercel.json, and the staging project deploys as "production"
// (the trap the lane sweep and artifact monitor both document). If the ingest
// tables are absent the route reports that and does not throw a nightly error.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runNightly } from "@/lib/ingest/nightly"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The sweep is serial and paced across ten boards. 159s measured on dev with
// three pairs; the ceiling leaves room for the pair list to grow.
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

type PingResult = true | false | "not_configured" | "skipped_alert"

/** Best-effort. A failed ping is not a failed sweep, but it is reported. */
async function pingDeadMansSwitch(): Promise<PingResult> {
  const url = process.env.INGEST_HEALTHCHECKS_PING_URL
  if (!url) return "not_configured"
  try {
    const res = await fetch(url, { method: "POST" })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"

  // The ingest tables may not exist here. A non-head select is the reliable
  // probe: head+count against a missing table returns 204 with error === null,
  // which reads as "exists, zero rows".
  const { error: probe } = await supabase.from("ingest_boards").select("source").limit(1)
  if (probe?.code === "PGRST205") {
    return Response.json({
      ok: true,
      skipped: "ingest tables absent in this environment",
      environment,
    })
  }

  try {
    const res = await runNightly(supabase, { environment })
    const ping: PingResult = res.alert ? "skipped_alert" : await pingDeadMansSwitch()

    return Response.json({
      ok: true,
      environment,
      totals: res.totals,
      durationMs: res.durationMs,
      alerted: !!res.alert,
      alertReasons: res.alert?.reasons.map((r) => r.kind) ?? [],
      ping,
    })
  } catch (err: any) {
    // A sweep that threw wrote no rows for the boards it never reached, and it
    // does NOT ping. The staleness check is what turns that into a signal if
    // the failure repeats.
    console.error("[ingest-nightly] sweep failed:", err?.message || err)
    return Response.json(
      { ok: false, environment, error: String(err?.message || err).slice(0, 500) },
      { status: 500 }
    )
  }
}
