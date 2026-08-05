import { postmarkClient, MESSAGE_STREAM } from "../postmark"

// Artifact-write monitor alert. Same Postmark client, message stream and
// support inbox as sendFeedbackNotification, so there is no new deliverability
// setup and no new domain to verify — stopapplyingblind.com is already
// verified, which is why any address on it sends without a per-address
// signature.
//
// SENDS ONLY WHEN SOMETHING IS WRONG. There is deliberately no daily
// all-clear: a monitor that emails every day becomes noise inside a week, then
// gets filtered, and then it is a dead monitor nobody notices is dead. The
// heartbeat row in monitor_runs is how you confirm it is alive; this mailbox
// is only for when it is not.

const ALERT_FROM_EMAIL =
  process.env.POSTMARK_FEEDBACK_FROM_EMAIL ?? "support@stopapplyingblind.com"

export type TableCounts = {
  table: string
  /** Newest first: index 0 is the last 24h. */
  daily: number[]
  last24h: number
  total7d: number
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Deep link to the table in Supabase Studio. Derives the project ref from
 * SUPABASE_URL so the link points at whichever environment actually ran the
 * check — dev while verifying, prod once promoted. Same helper shape as
 * studioRowLink in sendFeedbackNotification.
 */
function studioLink(): string | null {
  const ref = (process.env.SUPABASE_URL || "").match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1]
  return ref ? `https://supabase.com/dashboard/project/${ref}/editor` : null
}

export async function sendMonitorAlert({
  silentTables,
  counts,
  environment,
}: {
  /** The tables that tripped the check. Named in the subject. */
  silentTables: string[]
  /** EVERY watched table, so a cliff can be told from a slope at a glance. */
  counts: TableCounts[]
  environment: string
}): Promise<void> {
  const subject =
    silentTables.length === 1
      ? `[SIGNAL${environment === "production" ? "" : " " + environment}] ${silentTables[0]}: 0 rows in 24h`
      : `[SIGNAL${environment === "production" ? "" : " " + environment}] ${silentTables.length} artifact tables: 0 rows in 24h`

  const dayLabels = ["last 24h", "-2d", "-3d", "-4d", "-5d", "-6d", "-7d"]

  const textBody = [
    `Artifact-write monitor tripped.`,
    ``,
    `Silent in the last 24h: ${silentTables.join(", ")}`,
    ``,
    `Last 7 days, all watched tables (newest first):`,
    ...counts.map((c) => `  ${c.table.padEnd(22)} ${c.daily.join("  ")}   (7d total ${c.total7d})`),
    ``,
    `A table at 0 today with healthy numbers behind it is a CLIFF — something`,
    `broke, most likely a schema change the write depends on. A table that has`,
    `been trending down is a SLOPE, which is usually real usage.`,
    ``,
    `Next step: grep production logs for ARTIFACT_WRITE_FAILED. That marker`,
    `carries the table, the profileId and the database's own reason.`,
    ``,
    studioLink() ? `Supabase: ${studioLink()}` : ``,
  ].join("\n")

  const rows = counts
    .map((c) => {
      const silent = silentTables.includes(c.table)
      const cells = c.daily
        .map((n, i) => {
          const zero = n === 0
          const bg = zero && i === 0 ? "background:#FBE3D6;" : ""
          return `<td style="padding:6px 10px;text-align:right;${bg}color:${zero ? "#884133" : "#13294A"};">${n}</td>`
        })
        .join("")
      return `<tr style="${silent ? "background:#FDF3EF;" : ""}">
        <td style="padding:6px 10px;font-weight:${silent ? 700 : 400};color:${silent ? "#884133" : "#13294A"};">${esc(c.table)}</td>
        ${cells}
        <td style="padding:6px 10px;text-align:right;color:#526C87;">${c.total7d}</td>
      </tr>`
    })
    .join("")

  const htmlBody = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F4F8FB;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#884133;">
      Artifact-write monitor
    </div>
    <h1 style="font-size:20px;color:#13294A;margin:8px 0 4px;">
      ${esc(silentTables.join(", "))} — 0 rows in 24h
    </h1>
    <p style="color:#526C87;font-size:14px;margin:0 0 18px;">Environment: ${esc(environment)}</p>

    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="color:#526C87;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;">
          <th style="text-align:left;padding:6px 10px;">Table</th>
          ${dayLabels.map((d) => `<th style="text-align:right;padding:6px 10px;">${d}</th>`).join("")}
          <th style="text-align:right;padding:6px 10px;">7d</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="color:#526C87;font-size:13.5px;line-height:20px;margin:18px 0 0;">
      A table at 0 today with healthy numbers behind it is a <strong>cliff</strong> — something broke,
      most likely a schema change the write depends on. A table trending down is a <strong>slope</strong>,
      which is usually real usage.
    </p>
    <p style="color:#526C87;font-size:13.5px;line-height:20px;margin:10px 0 0;">
      Next step: grep production logs for <code>ARTIFACT_WRITE_FAILED</code>. That marker carries the
      table, the profileId and the database's own reason.
    </p>
    ${studioLink() ? `<p style="margin:18px 0 0;"><a href="${studioLink()}" style="color:#1F6FA8;font-weight:700;">Open Supabase</a></p>` : ""}
  </div>
</body></html>`

  await postmarkClient.sendEmail({
    From: ALERT_FROM_EMAIL,
    To: ALERT_FROM_EMAIL,
    Subject: subject,
    TextBody: textBody,
    HtmlBody: htmlBody,
    MessageStream: MESSAGE_STREAM,
    Tag: "monitor-alert",
  })
}
