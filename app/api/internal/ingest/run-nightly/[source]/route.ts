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
//
// SEVERAL CALLS A NIGHT. A source's cron fires more than once (vercel.json);
// each call sweeps the pairs not yet swept tonight until TICK_BUDGET_MS, then
// stops and leaves the rest to the next call. Progress is the pipeline_runs
// rows: each call's detail.pairsDone, written after every pair, so even a
// killed call loses at most the pair in hand. Once a call finishes the last
// pair, later calls that night do nothing. The Healthchecks ping goes only
// then, and only if no call tonight alerted: the check means "swept, clean".

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runNightly } from "@/lib/ingest/nightly"
import { ADAPTERS } from "@/lib/ingest/boards"
import { closeStale, finishStep, nightOf, nightRows, startStep, STEPS, type Step } from "@/lib/pipeline/runs"
import { TICK_BUDGET_MS } from "@/lib/pipeline/tick"
import { sendPipelineEmail } from "@/lib/email/sendPipelineAlert"

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

type PingResult = true | false | "not_configured" | "skipped_alert" | "not_complete"

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

  // The pipeline's record of this sweep (pipeline_runs): tonight's progress,
  // and what the 09:00 watchdog reads. Without the table (an environment
  // before 20261111_nightly_pipeline.sql) there is nothing to resume from, so
  // the sweep runs whole, as it did before.
  const started = Date.now()
  const step = `ats_${source}` as Step
  let pipelineRunId: string | null = null
  let done = new Set<string>()
  let alertedEarlier = false
  if ((STEPS as readonly string[]).includes(step)) {
    try {
      const rows = (await nightRows(supabase, nightOf())).filter((r) => r.step === step)
      for (const r of await closeStale(supabase, rows, started, [step])) {
        await sendPipelineEmail(`Job sourcing pipeline: ${step} was killed at the time limit (${r.night})`,
          `${step} started at ${r.started_at} and was killed at the function's time limit. The next call continues from the ${(r.detail?.pairsDone ?? []).length} pair(s) it recorded.
Environment: ${environment}`).catch(() => {})
      }
      const running = rows.find((r) => r.status === "running")
      if (running) return Response.json({ ok: true, source, environment, skipped: `a sweep is already running since ${running.started_at}` })
      if (rows.some((r) => r.detail?.complete)) return Response.json({ ok: true, source, environment, skipped: "tonight's sweep is complete" })
      done = new Set(rows.flatMap((r) => r.detail?.pairsDone ?? []))
      alertedEarlier = rows.some((r) => r.status === "error")
      pipelineRunId = await startStep(supabase, step, `nightly:${source}`)
    } catch (e: any) {
      console.error(`[ingest-nightly:${source}] pipeline_runs unavailable, sweeping whole: ${e?.message || e}`)
    }
  }
  const pairsDone: string[] = []

  try {
    const res = await runNightly(supabase, {
      environment, source,
      ...(pipelineRunId ? {
        deadline: started + TICK_BUDGET_MS,
        donePairIds: done,
        onPair: async (id: string) => {
          pairsDone.push(id)
          await supabase.from("pipeline_runs").update({ detail: { pairsDone } }).eq("id", pipelineRunId)
        },
      } : {}),
    })
    const complete = res.pairsLeft === 0
    const ping: PingResult = res.alert || alertedEarlier ? "skipped_alert" : complete ? await pingDeadMansSwitch(source) : "not_complete"
    if (pipelineRunId) {
      // Every ingest alert reason is a fault (lib/ingest/nightly.ts), and the ingest alert has already gone out.
      const detail = { ...res.totals, durationMs: res.durationMs, pairsDone: res.pairsDone, pairsDoneEarlier: done.size, pairsLeft: res.pairsLeft, complete }
      await finishStep(supabase, pipelineRunId, {
        status: res.alert ? "error" : complete ? "ok" : "capped", units: res.totals.runs,
        detail: complete || res.alert ? detail : { ...detail, capReason: "deadline" },
        error: res.alert ? `ingest alert: ${res.alert.reasons.map((r) => r.kind).join(", ")}` : undefined,
      }).catch((e: any) => console.error(`[ingest-nightly:${source}] pipeline_runs not updated: ${e?.message || e}`))
    }

    return Response.json({
      ok: true,
      source,
      environment,
      totals: res.totals,
      durationMs: res.durationMs,
      pairsSwept: res.pairsDone.length,
      pairsDoneEarlier: done.size,
      pairsLeft: res.pairsLeft,
      alerted: !!res.alert,
      alertReasons: res.alert?.reasons.map((r) => r.kind) ?? [],
      ping,
    })
  } catch (err: any) {
    console.error(`[ingest-nightly:${source}] sweep failed:`, err?.message || err)
    if (pipelineRunId) await finishStep(supabase, pipelineRunId, { status: "error", detail: { pairsDone }, error: String(err?.message || err) }).catch(() => {})
    return Response.json(
      { ok: false, source, environment, error: String(err?.message || err).slice(0, 500) },
      { status: 500 }
    )
  }
}
