/**
 * Nightly ingest alert.
 *
 * POSTMARK IS IMPORTED LAZILY, inside the send. lib/postmark.ts throws at
 * module load when POSTMARK_API_KEY is absent, so a static import would make
 * the whole nightly module unloadable in any environment without mail
 * credentials -- including a dry run whose entire point is not to send. The
 * alert's subject and body are pure functions and stay testable without a key.
 *
 * Same Postmark client, message stream and inbox as sendMonitorAlert, so there
 * is no new deliverability setup. A sibling rather than a reuse: that function
 * is shaped around per-table daily counts and forcing ingest results through
 * it would mean pretending boards are tables.
 *
 * SENDS ONLY WHEN SOMETHING IS WRONG, for the same reason the artifact monitor
 * does: a nightly all-clear becomes noise inside a week, then a filter rule,
 * then a monitor nobody notices has died. Liveness is the ingest_runs rows
 * themselves -- every board of every pair writes one, healthy or not, so
 * `SELECT max(created_at) FROM ingest_runs` answers "did the sweep run at all"
 * without a heartbeat table.
 */

const ALERT_FROM_EMAIL =
  process.env.POSTMARK_FEEDBACK_FROM_EMAIL ?? "support@stopapplyingblind.com"
const ALERT_TO_EMAIL = process.env.INGEST_ALERT_TO_EMAIL ?? ALERT_FROM_EMAIL

/** The three conditions, in the order a reader should care about them. */
export type AlertReason =
  | { kind: "zero_found"; totalFound: number }
  | { kind: "control_failed"; rows: { source: string; org: string; pair: string; detail: string }[] }
  | { kind: "run_error"; rows: { source: string; org: string; pair: string; error: string }[] }

export type IngestAlert = {
  environment: string
  reasons: AlertReason[]
  /** Every board of every pair, so a cliff can be told from a quiet night. */
  lines: string[]
  totals: { pairs: number; boards: number; runs: number; found: number; added: number; requests: number }
  durationMs: number
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function alertSubject(a: IngestAlert): string {
  const env = a.environment === "production" ? "" : " " + a.environment
  const kinds = a.reasons.map((r) => r.kind)
  if (kinds.includes("zero_found")) return `[SIGNAL${env}] ingest: 0 postings found across all pairs`
  const parts: string[] = []
  for (const r of a.reasons) {
    if (r.kind === "control_failed") parts.push(`${r.rows.length} control failure${r.rows.length === 1 ? "" : "s"}`)
    if (r.kind === "run_error") parts.push(`${r.rows.length} error${r.rows.length === 1 ? "" : "s"}`)
  }
  return `[SIGNAL${env}] ingest: ${parts.join(", ")}`
}

export function alertBody(a: IngestAlert): string {
  const out: string[] = ["Nightly ingest sweep tripped.", ""]

  for (const r of a.reasons) {
    if (r.kind === "zero_found") {
      out.push(
        `ZERO FOUND. ${a.totals.runs} board-runs across ${a.totals.pairs} pairs returned ${r.totalFound} postings`,
        `between them. Every board returning nothing at once is a system fault, not a quiet`,
        `night: check that the sources are reachable and that the pairs still have titles.`,
        ""
      )
    }
    if (r.kind === "control_failed") {
      out.push(`CONTROL FAILED on ${r.rows.length} board-run(s). These numbers describe an`, `UNFILTERED board and must not be read as results for their pair:`)
      for (const x of r.rows) out.push(`  ${x.source}/${x.org}  "${x.pair}"  ${x.detail}`)
      out.push("")
    }
    if (r.kind === "run_error") {
      out.push(`ERRORS on ${r.rows.length} board-run(s):`)
      for (const x of r.rows) out.push(`  ${x.source}/${x.org}  "${x.pair}"  ${x.error}`)
      out.push("")
    }
  }

  out.push(
    `Sweep totals: ${a.totals.pairs} pairs x ${a.totals.boards} boards = ${a.totals.runs} board-runs,`,
    `${a.totals.found} found, ${a.totals.added} added, ${a.totals.requests} requests, ${Math.round(a.durationMs / 1000)}s.`,
    "",
    "Every board-run, healthy or not:",
    ...a.lines,
    "",
    "Nothing is ever deleted from ingest_runs, so the full history is queryable.",
  )
  return out.join("\n")
}

export async function sendIngestAlert(a: IngestAlert): Promise<void> {
  const { postmarkClient, MESSAGE_STREAM } = await import("../postmark")
  const text = alertBody(a)
  await postmarkClient.sendEmail({
    From: ALERT_FROM_EMAIL,
    To: ALERT_TO_EMAIL,
    Subject: alertSubject(a),
    TextBody: text,
    HtmlBody: `<pre style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#13294A;">${esc(text)}</pre>`,
    MessageStream: MESSAGE_STREAM,
  })
}

// ---------------------------------------------------------------------------
// Staleness: has ingest written anything at all?
// ---------------------------------------------------------------------------
// A separate shape rather than a fourth AlertReason, because it carries none of
// a sweep's structure. There are no totals and no board lines: the whole point
// is that no sweep happened.

export type StalenessAlert = {
  environment: string
  /** null when ingest_runs is empty: never run. */
  lastRunAt: string | null
  hoursSince: number | null
  thresholdHours: number
  /** The last few rows, so "stopped after failing" reads differently from "stopped clean". */
  recent: { source: string; org: string; pair: string; status: string; at: string }[]
}

export function stalenessSubject(a: StalenessAlert): string {
  const env = a.environment === "production" ? "" : " " + a.environment
  if (a.lastRunAt === null) return `[SIGNAL${env}] ingest has NEVER run`
  return `[SIGNAL${env}] ingest silent for ${Math.floor(a.hoursSince ?? 0)}h`
}

export function stalenessBody(a: StalenessAlert): string {
  const out: string[] = []

  if (a.lastRunAt === null) {
    out.push(
      "ingest_runs is EMPTY. Ingest has never written a row.",
      "",
      "This is not a quiet night. Either the sweep has never been scheduled, or it has",
      "never reached the point of logging. Check that the cron entry exists and that",
      "ingest_pairs and ingest_boards have active rows."
    )
  } else {
    out.push(
      `No ingest_runs row has been written for ${Math.floor(a.hoursSince ?? 0)} hours.`,
      `Threshold is ${a.thresholdHours}h; the sweep is expected nightly.`,
      "",
      `Last row: ${a.lastRunAt}`,
      "",
      "The sweep writes a row per board per pair whether it succeeds or fails, so",
      "silence means the run did not happen at all -- not that it happened and found",
      "nothing. Check the scheduler first, then the function logs.",
      ""
    )
    if (a.recent.length) {
      out.push("Last rows written, newest first:")
      for (const r of a.recent) {
        out.push(`  ${r.at}  ${r.source}/${r.org}  "${r.pair}"  ${r.status}`)
      }
      out.push("")
      out.push("If those are all errors, the run was failing before it stopped.")
    }
  }

  out.push(
    "",
    "This check is the INNER layer. If the scheduler itself is down it does not run",
    "either, and its silence looks like health. The external dead-man's switch is",
    "the outer layer: it alarms when it stops being pinged."
  )
  return out.join("\n")
}

export async function sendStalenessAlert(a: StalenessAlert): Promise<void> {
  const { postmarkClient, MESSAGE_STREAM } = await import("../postmark")
  const text = stalenessBody(a)
  await postmarkClient.sendEmail({
    From: ALERT_FROM_EMAIL,
    To: ALERT_TO_EMAIL,
    Subject: stalenessSubject(a),
    TextBody: text,
    HtmlBody: `<pre style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#13294A;">${esc(text)}</pre>`,
    MessageStream: MESSAGE_STREAM,
  })
}
