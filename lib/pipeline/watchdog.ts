/**
 * 09:00 UTC: did every step of last night's pipeline run and finish?
 *
 * The ticks email about what they did: failures and caps. Only something
 * outside them can see what did not happen at all, so this reads tonight's
 * pipeline_runs and reports:
 *   - a step with no row: skipped (its cron never fired, or the ticks ran out)
 *   - a step still running: stuck
 *   - enrich or match stopped at the time limit with work left after the last tick
 * Failures and caps are not repeated here; the tick already sent those.
 *
 * DISABLED IS NOT SILENT. Where PIPELINE_ENABLED is not "true" the ticks do
 * nothing; if this database has active clients waiting on matches, that is
 * reported every morning until it is switched on. A database with none (dev,
 * staging) stays quiet.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { nightOf, nightRows, STEPS, type RunRow } from "./runs"
import { runPaceCheck } from "./cost"

export function watchdogFindings(rows: RunRow[]): string[] {
  const out: string[] = []
  for (const step of STEPS) {
    const mine = rows.filter((r) => r.step === step)
    const last = mine.at(-1)
    if (!last) { out.push(`${step}: skipped, no run recorded tonight`); continue }
    if (last.status === "running") out.push(`${step}: still running since ${last.started_at}`)
    else if (last.status === "capped" && last.detail?.capReason === "deadline") {
      out.push(`${step}: ran out of time with work left after ${mine.length} run(s); the rest waits for tomorrow night (${JSON.stringify(last.detail?.deferred ?? last.detail?.dueAfter ?? "")} left)`)
    }
  }
  return out
}

export async function runWatchdog(
  sb: SupabaseClient,
  opts: { enabled: boolean; environment: string; send: (subject: string, text: string) => Promise<void>; now?: Date },
): Promise<{ night: string; findings: string[]; disabled?: boolean; pace?: { sent: string[]; error?: string } }> {
  const night = nightOf(opts.now)
  if (!opts.enabled) {
    const { count, error } = await sb.from("client_match_criteria").select("client_profile_id", { count: "exact", head: true }).eq("active", true)
    if (error) throw new Error("client_match_criteria: " + error.message)
    const findings = count ? [`the nightly pipeline is disabled here (PIPELINE_ENABLED is not "true") while ${count} client(s) have active criteria`] : []
    if (findings.length) await opts.send(`Job sourcing pipeline: disabled (${night})`, `${findings[0]}.\nNo Google Jobs searches, enrichment, matching or link checks are running.\nEnvironment: ${opts.environment}`)
    return { night, findings, disabled: true }
  }
  const findings = watchdogFindings(await nightRows(sb, night))
  if (findings.length) {
    await opts.send(`Job sourcing pipeline: ${findings.length} step(s) did not complete (${night})`, `Last night's pipeline (${night}):\n\n${findings.map((f) => "  - " + f).join("\n")}\n\nEnvironment: ${opts.environment}`)
  }
  // Again here, so a manual run during the day is caught by the next morning at the latest.
  let pace: { sent: string[]; error?: string }
  try {
    const p = await runPaceCheck(sb, { apiKey: process.env.SEARCHAPI_KEY, send: opts.send })
    pace = { sent: p.sent.map((a) => a.kind), ...(p.searchError ? { error: p.searchError } : {}) }
  } catch (e: any) { pace = { sent: [], error: String(e?.message ?? e) } }
  return { night, findings, pace }
}
