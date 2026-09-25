// lib/email/signature.ts
//
// THE SIGNAL email signature, as one block, for every client-facing email.
//
// It is not pasted into templates. It is compiled into a Postmark LAYOUT
// (see scripts/sync-email-layout.ts), and a template that names that layout
// gets the header and this signature without restating either. That is what
// makes it the default rather than a convention people have to remember.
//
// COLOURS ARE SAMPLED FROM logo/"sample signature.png", NOT CHOSEN. The
// reference is the signature already in use, so the values here are what it
// actually renders:
//
//   navy   #25395C  name, email, the consult link, the vertical divider
//   teal   #2CA58D  the title, and the four social icons
//   tan    #E8A66C  the two website links
//   grey   #333333  the phone number
//
// The teal is taken from the icon PNGs rather than from the flattened
// reference, which reads #54A38E because of anti-aliasing. Matching the icons
// is what matters: the title sits beside them.
//
// NOTE: this navy is NOT the brand #08203F used in email bodies. The
// signature's navy is the one in the existing artwork, including inside the
// SIGNAL logo, so changing it would leave the wordmark disagreeing with the
// text beside it.

export const SIG = {
  navy: "#25395C",
  teal: "#2CA58D",
  tan: "#E8A66C",
  grey: "#333333",
} as const

/**
 * Where the images live.
 *
 * public/ on this Vercel project: a stable URL we control and can redeploy,
 * versioned with the code, and not Postmark's asset store. All six were
 * confirmed reachable before this shipped.
 */
export const ASSET_BASE = "https://wrnsignal-api.vercel.app/logo"

export const SOCIALS = [
  { key: "facebook", label: "Facebook", href: "https://www.facebook.com/WorkforceReadyNow", icon: "ic_facebook.png" },
  { key: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/workforce-ready-now", icon: "ic_linkedin.png" },
  { key: "instagram", label: "Instagram", href: "https://www.instagram.com/perigetsyouhired", icon: "ic_instagram.png" },
  { key: "tiktok", label: "TikTok", href: "https://www.tiktok.com/@perigetsyouhired", icon: "ic_tiktok.png" },
] as const

export const CONSULT_URL = "https://workforcereadynow.com/consult-request"

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

/**
 * The signature, as a table.
 *
 * Two columns with a navy rule between them, stacking to one column on a phone.
 * The stack is a media query on `.sig-col`, which Gmail, Apple Mail and iOS
 * honour; Outlook desktop ignores it and keeps the two columns, which is the
 * correct fallback because Outlook desktop is never narrow.
 *
 * Widths and cellpadding are attributes as well as CSS because Outlook's word
 * engine reads the attributes and not the stylesheet.
 */
export function signatureHtml(): string {
  const icons = SOCIALS.map((s) => `
              <td style="padding:0 8px 0 0;">
                <a href="${s.href}" target="_blank" style="text-decoration:none;">
                  <img src="${ASSET_BASE}/${s.icon}" width="32" height="32" alt="${s.label}"
                       style="display:block;border:0;width:32px;height:32px;border-radius:7px;" />
                </a>
              </td>`).join("")

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td style="padding:8px 0 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <!-- Left: the two marks, stacked. -->
          <td class="sig-col" width="210" valign="top" style="width:210px;padding:0 22px 0 0;">
            <img src="${ASSET_BASE}/WRN_Transparent_Logo.png" width="170" alt="Workforce Ready Now"
                 style="display:block;border:0;width:170px;max-width:170px;height:auto;" />
            <img src="${ASSET_BASE}/SIGNAL_logo_navy_email.png" width="190" alt="SIGNAL, stop applying blind"
                 style="display:block;border:0;width:190px;max-width:190px;height:auto;margin-top:18px;" />
          </td>

          <!-- The divider. A bordered cell, because a 2px image would not scale
               and a <hr> cannot be vertical in Outlook. -->
          <td class="sig-rule" width="2" valign="top"
              style="width:2px;border-left:2px solid ${SIG.navy};font-size:0;line-height:0;">&nbsp;</td>

          <td class="sig-col" valign="top" style="padding:0 0 0 22px;font-family:${FONT};">
            <div style="font-size:24px;font-weight:700;color:${SIG.navy};line-height:1.2;">Peri Ginsberg</div>
            <div style="font-size:16px;font-weight:700;color:${SIG.teal};line-height:1.4;padding-top:2px;">Founder &amp; CEO</div>

            <div style="padding-top:12px;font-size:15px;line-height:1.7;color:${SIG.navy};">
              <a href="mailto:peri@workforcereadynow.com" style="color:${SIG.navy};text-decoration:none;">peri@workforcereadynow.com</a><br />
              <a href="tel:+15612101291" style="color:${SIG.grey};text-decoration:none;">(561) 210-1291</a>
            </div>

            <div style="padding-top:10px;font-size:15px;font-weight:700;line-height:1.7;">
              <a href="https://workforcereadynow.com" target="_blank" style="color:${SIG.tan};text-decoration:none;">workforcereadynow.com</a><br />
              <a href="https://stopapplyingblind.com" target="_blank" style="color:${SIG.tan};text-decoration:none;">stopapplyingblind.com</a>
            </div>

            <div style="padding-top:14px;font-size:16px;font-weight:700;">
              <a href="${CONSULT_URL}" target="_blank" style="color:${SIG.navy};text-decoration:underline;">Click Here to Schedule a FREE Consult</a>
            </div>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:14px;">
              <tr>${icons}
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim()
}

/** The plain-text signature. Kept in step with the HTML by hand, and short. */
export function signatureText(): string {
  return [
    "Peri Ginsberg",
    "Founder & CEO",
    "peri@workforcereadynow.com",
    "(561) 210-1291",
    "workforcereadynow.com | stopapplyingblind.com",
    "",
    `Schedule a free consult: ${CONSULT_URL}`,
  ].join("\n")
}

/**
 * The styles the layout needs in its <head>: the phone stack, and nothing else.
 *
 * Kept beside the markup it governs, rather than in the layout file, so a
 * change to the columns and a change to the breakpoint happen in one place.
 */
export function signatureStyles(): string {
  return `
    @media only screen and (max-width: 520px) {
      /* Two columns become one. The divider would be a stray horizontal line
         once stacked, so it is removed rather than rotated. */
      .sig-col { display:block !important; width:100% !important; max-width:100% !important; padding:0 0 18px 0 !important; }
      .sig-rule { display:none !important; }
    }`.trim()
}
