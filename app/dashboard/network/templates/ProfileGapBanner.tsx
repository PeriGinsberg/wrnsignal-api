"use client"

// The one thing that matters more than any wording on this page: if the profile
// is empty, every preview renders with blanks and the whole screen looks broken.
// This says why, before anyone concludes the tool is.
//
// SOFT, never blocking. The page stays fully usable — nobody is locked out of
// their own tool because a form is unfinished. Warm, because warm means "needs
// your attention" (COLOR-SYSTEM.md §1), which is exactly what this is.
//
// The threshold is IMPORTED, not restated: sendReadiness() is the same product
// rule the profile screen shows its meter against, so the two screens can never
// disagree about whether someone is ready.

import { T } from "../../../../lib/dashboard-theme"
import { sendReadiness } from "../profile/fieldState"

export function ProfileGapBanner({ profile }: { profile: Record<string, unknown> | null }) {
  // No profile loaded yet is not the same as an empty one — say nothing rather
  // than flash a warning at someone whose fetch has not landed.
  if (profile == null) return null
  if (sendReadiness(profile).ready) return null

  return (
    <div data-testid="profile-gap-banner" style={{
      marginTop: 14, padding: "11px 14px", borderRadius: 11, maxWidth: 640,
      background: T.WARNING_BG, border: `1px solid ${T.ORANGE_BORDER}`,
      color: T.TEXT, fontSize: 12.5, lineHeight: "19px",
    }}>
      Your messages pull from your profile — and yours is mostly empty, so the previews below
      will have gaps. Fill in your profile first and these will read like you.{" "}
      <a href="/dashboard/network/profile" data-testid="profile-gap-link"
        style={{ color: T.WRN_ORANGE, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}>
        → Go to your profile
      </a>
    </div>
  )
}
