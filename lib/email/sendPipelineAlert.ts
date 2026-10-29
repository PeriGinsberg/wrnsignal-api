/**
 * Nightly pipeline emails: step failures and caps, the watchdog's skipped and
 * stuck steps, cost pace alerts and the Monday cost report.
 *
 * Same Postmark client, sender and inbox as the ingest alert
 * (sendIngestAlert.ts), and Postmark is imported lazily for the same reason:
 * lib/postmark.ts throws at load without a key, which would make a dry run
 * unloadable.
 */

const FROM = process.env.POSTMARK_FEEDBACK_FROM_EMAIL ?? "support@stopapplyingblind.com"
const TO = process.env.INGEST_ALERT_TO_EMAIL ?? FROM

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export async function sendPipelineEmail(subject: string, text: string): Promise<void> {
  const { postmarkClient, MESSAGE_STREAM } = await import("../postmark")
  await postmarkClient.sendEmail({
    From: FROM,
    To: TO,
    Subject: subject,
    TextBody: text,
    HtmlBody: `<pre style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#13294A;">${esc(text)}</pre>`,
    MessageStream: MESSAGE_STREAM,
  })
}
