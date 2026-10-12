import { sendToClient } from "./send"

interface SendClientInviteParams {
  clientFirstName: string
  clientEmail: string
  targetRoles: string
  targetLocations: string
  timeframe: string
  magicLink: string
  coachName: string
  coachClientId: string
  /** The coach who clicked Send Invite. */
  actor: string
}

export async function sendClientInvite({
  clientFirstName,
  clientEmail,
  targetRoles,
  targetLocations,
  timeframe,
  magicLink,
  coachName,
  coachClientId,
  actor,
}: SendClientInviteParams) {
  const subject = `Your SIGNAL account is ready, ${clientFirstName}`

  // Targets block renders conditionally. Existing caller (coach/create-client)
  // always passes non-empty values → hasAnyTargets is true → identical
  // output to pre-change behavior. New caller (coach/coach-clients/[id]/
  // send-invite) passes empty strings when the coach hasn't captured
  // targets yet → alternate copy renders ("coach will be in touch") and
  // the table is omitted. See FRD §6.5 + Commit 2c, 2026-05-23.
  const hasAnyTargets = Boolean(
    (targetRoles && targetRoles.trim()) ||
    (targetLocations && targetLocations.trim()) ||
    (timeframe && timeframe.trim())
  )

  const targetsBlockHtml = hasAnyTargets
    ? `      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;">
        Your coach <strong style="color:#2A0F35;">${coachName}</strong> has configured your profile with the following targets:
      </p>

      <!-- Profile summary -->
      <div style="background:#FAF5F7;border:1px solid #EDD5E0;border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;width:120px;vertical-align:top;">Roles</td>
            <td style="padding:6px 0;font-size:14px;color:#2A0F35;font-weight:600;">${targetRoles}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;">Locations</td>
            <td style="padding:6px 0;font-size:14px;color:#2A0F35;font-weight:600;">${targetLocations}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#888;text-transform:uppercase;letter-spacing:0.05em;vertical-align:top;">Timeframe</td>
            <td style="padding:6px 0;font-size:14px;color:#2A0F35;font-weight:600;">${timeframe}</td>
          </tr>
        </table>
      </div>`
    : `      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px;">
        Your coach <strong style="color:#2A0F35;">${coachName}</strong> will be in touch with details about your job search targets.
      </p>`

  // THE BODY ONLY. The header, the rule and the signature come from the
  // signal-client layout, which sendToClient wraps every client email in; this
  // used to be a whole page of its own, with its own header and no signature.
  const html = `<div style="font-size:18px;color:#2A0F35;margin-bottom:16px;">Hi ${clientFirstName},</div>

<p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;">
  Workforce Ready Now has set up your SIGNAL account. SIGNAL is your personal job search command center. It scores your fit for any role before you apply, rewrites your resume to match, and generates networking outreach so you land interviews faster.
</p>

${targetsBlockHtml}

<p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px;">
  Click below to sign in and start using SIGNAL. No password needed. This link logs you in automatically.
</p>

<div style="text-align:center;margin-bottom:24px;">
  <a href="${magicLink}" style="display:inline-block;background:#3D1A4A;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.02em;">
    Open My SIGNAL Account
  </a>
</div>

<p style="font-size:12px;color:#999;line-height:1.6;margin:0 0 8px;">
  If the button doesn't work, copy and paste this link into your browser:
</p>
<p style="font-size:12px;color:#3D1A4A;word-break:break-all;line-height:1.5;margin:0 0 24px;">
  ${magicLink}
</p>

<hr style="border:none;border-top:1px solid #EDD5E0;margin:24px 0;" />

<p style="font-size:12px;color:#999;line-height:1.6;margin:0;">
  This email was sent by Workforce Ready Now on behalf of your coach. If you didn't expect this, you can safely ignore it.
</p>`

  const targetsBlockText = hasAnyTargets
    ? `Your coach ${coachName} has configured your profile with the following targets:

Roles: ${targetRoles}
Locations: ${targetLocations}
Timeframe: ${timeframe}`
    : `Your coach ${coachName} will be in touch with details about your job search targets.`

  const textBody = `Hi ${clientFirstName},

Workforce Ready Now has set up your SIGNAL account. SIGNAL is your personal job search command center. It scores your fit for any role before you apply, rewrites your resume to match, and generates networking outreach so you land interviews faster.

${targetsBlockText}

Click below to sign in and start using SIGNAL:
${magicLink}

No password needed. This link logs you in automatically.

---
This email was sent by Workforce Ready Now on behalf of your coach.
If you didn't expect this, you can safely ignore it.`

  // Throws on failure, as it always has: both callers catch it and report
  // email_sent: false.
  const res = await sendToClient({
    to: clientEmail,
    content: { subject, html, text: textBody },
    log: { type: "invite", coachClientId, actor },
  })
  if (!res.ok) throw new Error(res.error)
}
