// Colour identity per group — see docs/network-tracker/COLOR-SYSTEM.md §2. A
// 3px left rail always means "what family is this", never "what state is this
// contact in"; that shape rule is what lets green be both a Replies rail and a
// "they replied" pill without either being misread.
//
// The SEQUENCE gets no colour. It is the primary content, and colouring only
// the two secondary groups makes them read as asides rather than three peers
// competing for the same attention. It also keeps warm free for what warm means
// on this function — "you write this" — which inside these very cards is the
// fill-at-send bracket. Warm was the sequence's identity for one commit and
// that was a mistake: it made a card show a warm rail, warm step circles and
// warm brackets, three warm things meaning three different amounts.
//
// Every value is a theme token. A fourth group added here without a token would
// be the moment a hardcoded hex creeps back in.

import { T } from "../../../../lib/dashboard-theme"

export type Accent = {
  /** Section rail and header. null = no rail, plain header: the neutral group. */
  line: string | null
  border: string        // a tinted card edge, quieter than `line`
  bg: string            // pill fill behind the edited marker
  onCard: string | null // card label colour; null keeps the standard white
  /** Step-circle fill. Neutral for the uncoloured group. */
  step: string
  /** Ink on the step circle, paired with `step`. */
  stepInk: string
}

export const ACCENTS: Record<"sequence" | "reply" | "linkedin", Accent> = {
  sequence: {
    line: null, border: T.BORDER, bg: T.GLASS, onCard: null,
    step: T.GLASS, stepInk: T.TEXT,
  },
  reply: {
    line: T.SUCCESS, border: T.SUCCESS_BORDER, bg: T.SUCCESS_BG, onCard: T.SUCCESS,
    step: T.SUCCESS, stepInk: T.INK_ON_ACCENT,
  },
  linkedin: {
    line: T.WRN_PINK, border: T.PINK_BORDER, bg: T.PINK_BG, onCard: T.WRN_PINK,
    step: T.WRN_PINK, stepInk: T.INK_ON_ACCENT,
  },
}
