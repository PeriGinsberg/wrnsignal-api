// One colour identity per group, so the three kinds of message are told apart
// by hue before anything is read: warm for the outreach sequence, green for the
// replies (the same green the pipeline uses for "replied" — the after-they-
// respond world), pink for LinkedIn.
//
// Every value is a theme token. A fourth group added here without a token would
// be the moment a hardcoded hex creeps back in.

import { T } from "../../../../lib/dashboard-theme"

export type Accent = {
  line: string          // the section rail and header
  border: string        // a tinted card edge, quieter than `line`
  bg: string            // pill fill behind the edited marker
  onCard: string | null // card label colour; null keeps the standard white
}

export const ACCENTS: Record<"sequence" | "reply" | "linkedin", Accent> = {
  // The sequence carries its identity in the rail and the step numbers, so the
  // card titles stay standard white — colouring those too would leave nothing
  // on the card reading as ordinary text.
  sequence: { line: T.WRN_ORANGE, border: T.ORANGE_BORDER, bg: T.WARNING_BG, onCard: null },
  reply: { line: T.SUCCESS, border: T.SUCCESS_BORDER, bg: T.SUCCESS_BG, onCard: T.SUCCESS },
  linkedin: { line: T.WRN_PINK, border: T.PINK_BORDER, bg: T.PINK_BG, onCard: T.WRN_PINK },
}
