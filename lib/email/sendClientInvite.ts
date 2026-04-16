import { postmarkClient, FROM_EMAIL, MESSAGE_STREAM } from "../postmark"

interface SendClientInviteParams {
  clientFirstName: string
  clientEmail: string
  targetRoles: string
  targetLocations: string
  timeframe: string
  magicLink: string
  coachName: string
}

export async function sendClientInvite({
  clientFirstName,
  clientEmail,
  targetRoles,
  targetLocations,
  timeframe,
  magicLink,
  coachName,
}: SendClientInviteParams) {
  const subject = `Your SIGNAL account is ready, ${clientFirstName}`

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FDF8F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;padding:0 20px;">

    <!-- Header -->
    <div style="background:#3D1A4A;padding:32px 40px;border-radius:12px 12px 0 0;">
      <div style="font-size:28px;font-weight:300;color:#ffffff;letter-spacing:0.08em;">SIGNAL</div>
      <div style="font-size:12px;color:#F2C4D0;letter-spacing:0.1em;margin-top:4px;">by Workforce Ready Now</div>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:40px;border-radius:0 0 12px 12px;border:1px solid #EDD5E0;border-top:none;">

      <div style="font-size:18px;color:#2A0F35;margin-bottom:16px;">Hi ${clientFirstName},</div>

      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;">
        Workforce Ready Now has set up your SIGNAL account. SIGNAL is your personal job search command center — it scores your fit for any role before you apply, rewrites your resume to match, and generates networking outreach so you land interviews faster.
      </p>

      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px;">
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
      </div>

      <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px;">
        Click below to sign in and start using SIGNAL. No password needed — this link logs you in automatically.
      </p>

      <!-- CTA Button -->
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
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:11px;color:#999;">&copy; ${new Date().getFullYear()} Workforce Ready Now. All rights reserved.</div>
    </div>
  </div>
</body>
</html>`

  const textBody = `Hi ${clientFirstName},

Workforce Ready Now has set up your SIGNAL account. SIGNAL is your personal job search command center — it scores your fit for any role before you apply, rewrites your resume to match, and generates networking outreach so you land interviews faster.

Your coach ${coachName} has configured your profile with the following targets:

Roles: ${targetRoles}
Locations: ${targetLocations}
Timeframe: ${timeframe}

Click below to sign in and start using SIGNAL:
${magicLink}

No password needed — this link logs you in automatically.

---
This email was sent by Workforce Ready Now on behalf of your coach.
If you didn't expect this, you can safely ignore it.`

  await postmarkClient.sendEmail({
    From: FROM_EMAIL,
    To: clientEmail,
    Subject: subject,
    HtmlBody: html,
    TextBody: textBody,
    MessageStream: MESSAGE_STREAM,
  })
}
