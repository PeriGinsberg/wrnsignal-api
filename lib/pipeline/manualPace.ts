/**
 * The cost pace check after a manual enrichment or matching run, so a large
 * one-off spend alerts the same day rather than at the next nightly tick.
 * Never fails the run: the spend already happened, and the 09:00 watchdog runs
 * the same check.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { runPaceCheck } from "./cost"

export async function paceCheckAfterManualRun(sb: SupabaseClient, apiKey: string | undefined): Promise<void> {
  try {
    const { sendPipelineEmail } = await import("../email/sendPipelineAlert")
    const r = await runPaceCheck(sb, { apiKey, send: sendPipelineEmail })
    const sent = r.sent.map((a) => a.kind)
    console.log(`Cost pace: ${sent.length ? "alert sent (" + sent.join(", ") + ")" : "within limits or already alerted"}${r.searchError ? `; SearchApi usage unavailable: ${r.searchError}` : ""}`)
  } catch (e: any) {
    console.log(`Cost pace check not run (${String(e?.message ?? e).slice(0, 160)}); the 09:00 watchdog runs it.`)
  }
}
