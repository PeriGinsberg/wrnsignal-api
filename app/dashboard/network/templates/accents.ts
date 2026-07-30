// Colour identity per group. See docs/network-tracker/COLOR-SYSTEM.md §2. A
// 3px left rail always means "what family is this", never "what state is this
// contact in"; that shape rule is what lets green be both a Replies rail and a
// "they replied" pill without either being misread.
//
// The SEQUENCE is ice blue: its own group identity, in a colour that carries no
// other meaning on this function. It was warm for one commit, which was wrong:
// warm means "act here", and a card was showing a warm rail, warm step circles
// AND warm fill-at-send brackets, three warm things meaning three different
// amounts. Neutral fixed that but cost the sequence its identity and the step
// circles their fill; ice blue restores both without taking warm back.
//
// Ice is blue-family like WRN_BLUE (link / in-progress) but near-white against
// its mid-blue. See the luminance note on the token. They do not collide.
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
  // Card titles stay white: the rail and the filled step circles carry the
  // identity, and colouring the titles too would leave nothing on the card
  // reading as ordinary text.
  sequence: {
    line: T.ICE_BLUE, border: T.ICE_BLUE_BORDER, bg: T.ICE_BLUE_BG, onCard: null,
    step: T.ICE_BLUE, stepInk: T.INK_ON_ACCENT,
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
