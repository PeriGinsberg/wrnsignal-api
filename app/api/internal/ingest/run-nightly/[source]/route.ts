// app/api/internal/ingest/run-nightly/[source]/route.ts
//
// One nightly sweep per source: /run-nightly/grnhse, /run-nightly/smartrecruiters.
//
// WHY SPLIT. The combined sweep across 149 boards took 731s, against a 300s
// function ceiling, so the cron would have been killed roughly 40% through
// every night and left a partial result with no alert. Splitting also means a
// source failing does not delay or cancel the other, and each gets a schedule
// matched to its own cost: Greenhouse downloads whole boards once per sweep,
// SmartRecruiters issues two requests per board per pair.
//
// ONE DYNAMIC ROUTE RATHER THAN A FILE PER SOURCE. The paths are separate and
// the crons are separate, which is what matters; the handler is identical
// apart from one string, and a copy per adapter would drift. Unknown sources
// are rejected rather than swept, so the dynamic segment cannot be used to
// invent a source.
//
// AUTH, the ping and the tables-absent skip behave exactly as the combined
// route did.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runNightly } from "@/lib/ingest/nightly"
import { ADAPTERS } from "@/lib/ingest/boards"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Measured per source rather than guessed: see the durations in the route's
// own response. The ceiling is the platform maximum, not an estimate, because
// a sweep killed part-way writes a partial result and never alerts.
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

type PingResult = true | false | "not_configured" | "skipped_alert"

/** Best-effort. A failed ping is not a failed sweep, but it is reported. */
async function pingDeadMansSwitch(source: string): Promise<PingResult> {
  // Per-source check, falling back to the shared one. Two sources pinging a
  // single check would let either keep it green while the other is dead.
  const url =
    process.env[`INGEST_HEALTHCHECKS_PING_URL_${source.toUpperCase()}`] ||
    process.env.INGEST_HEALTHCHECKS_PING_URL
  if (!url) return "not_configured"
  try {
    const res = await fetch(url, { method: "POST" })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const { source } = await ctx.params
  if (!ADAPTERS[source]) {
    return Response.json(
      { ok: false, error: `unknown source "${source}"`, known: Object.keys(ADAPTERS) },
      { status: 404 }
    )
  }

  const supabase = getSupabaseAdmin()
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"

  const { error: probe } = await supabase.from("ingest_boards").select("source").limit(1)
  if (probe?.code === "PGRST205") {
    return Response.json({ ok: true, source, skipped: "ingest tables absent in this environment", environment })
  }

  try {
    const res = await runNightly(supabase, { environment, source })
    const ping: PingResult = res.alert ? "skipped_alert" : await pingDeadMansSwitch(source)

    return Response.json({
      ok: true,
      source,
      environment,
      totals: res.totals,
      durationMs: res.durationMs,
      alerted: !!res.alert,
      alertReasons: res.alert?.reasons.map((r) => r.kind) ?? [],
      ping,
    })
  } catch (err: any) {
    console.error(`[ingest-nightly:${source}] sweep failed:`, err?.message || err)
    return Response.json(
      { ok: false, source, environment, error: String(err?.message || err).slice(0, 500) },
      { status: 500 }
    )
  }
}
