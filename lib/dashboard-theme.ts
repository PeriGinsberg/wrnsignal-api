// lib/dashboard-theme.ts
import { SPACE, TYPE } from "./theme/surfaces"

// EVERY TOKEN IS A CSS VARIABLE WITH ITS DARK VALUE AS THE FALLBACK.
//
// `background: T.CARD` still works, still type-checks, and still renders the
// dark navy when nothing sets the variable. A surface changes theme by setting
// --sig-* on a wrapper; see lib/theme/coachSurface.ts for why this rather than
// editing 1,493 call sites.
//
// THE FALLBACK IS THE SAFETY LINE. A page outside the shell, a component
// rendered in isolation, a test with no stylesheet: all of them get the
// original hex, which is what the Coaches Center has always looked like.
export const T = {
  BG: "var(--sig-bg, #13294A)",
  NAV_BG: "var(--sig-nav-bg, #091629)",
  CARD: "var(--sig-card, #0F1F38)",
  GLASS: "var(--sig-glass, rgba(255,255,255,0.07))",
  BORDER: "var(--sig-border, rgba(255,255,255,0.12))",
  BORDER_SOFT: "var(--sig-border-soft, rgba(255,255,255,0.08))",
  TEXT: "var(--sig-text, rgba(255,255,255,0.92))",
  MUTED: "var(--sig-muted, rgba(255,255,255,0.60))",
  DIM: "var(--sig-dim, rgba(255,255,255,0.35))",
  WRN_ORANGE: "var(--sig-wrn-orange, #FEB06A)",
  WRN_BLUE: "var(--sig-wrn-blue, #51ADE5)",
  WRN_TEAL: "var(--sig-wrn-teal, #218C8C)",
  // SIGNAL's pink, the same value the marketing palette calls `pink`. That
  // palette's orange/blue/green are byte-identical to WRN_ORANGE/WRN_BLUE/
  // SUCCESS below, so this is one system and the hex belongs here rather than
  // being retyped wherever a fourth accent is wanted.
  WRN_PINK: "var(--sig-wrn-pink, #EC4899)",
  // Ice blue: the pale cyan the product already uses (the Internship pill on
  // the JobFit main component). Near-white with a cyan cast, which is what
  // keeps it clearly apart from WRN_BLUE below despite both being blue-family:
  // luminance 0.933 against WRN_BLUE's 0.373, a 2.32:1 ratio between them.
  ICE_BLUE: "var(--sig-ice-blue, #DCFEFF)",
  // "Achieved", distinct from the action-warm above. Attention and done cannot
  // share a hex. See docs/network-tracker/COLOR-SYSTEM.md. This is the gold the
  // product already uses (JobFit's Review pill), reused rather than inventing a
  // second one; the two never appear on the same screen.
  GOLD: "var(--sig-gold, #D4A444)",

  // Task-surface accents, added 2026-09-26 for the task list and the
  // condensed Action Items row. DELIBERATELY NOT the WRN_* values above:
  // these are more saturated, and none of the four already existed here.
  // Named by role rather than by hue so the meaning survives a repaint.
  /** Column headers. Small uppercase. */
  TASK_HEADER: "var(--sig-task-header, #009BFF)",
  /** Overdue: the row border and the due chip. NEVER body text. */
  TASK_OVERDUE: "var(--sig-task-overdue, #FF6B00)",
  /** Done: the status pill and the tick. */
  TASK_DONE: "var(--sig-task-done, #00B3B3)",
  /** Open: the status pill outline. */
  TASK_OPEN: "var(--sig-task-open, #B6F2F8)",

  // ── Coaches Center section identity ─────────────────────────────────────
  // Every dashboard card had the same orange rule and orange icon, so the
  // sections did not read as different things. One accent each, taken from
  // the JobFit brand palette, applied to the card's top rule, its icon and
  // its count pill.
  //
  // Two palette members are not here. Navy #08203F is the ground on JobFit's
  // light surfaces and is invisible as a rule on this dark one. Peach tint
  // #FFEEDC is a FILL there, but on navy it reads as a pale rule and works,
  // so it takes the fifth section.
  //
  // Orange stays on Action Items on purpose: JobFit's rule is that #FF6B00
  // draws rules, numerals, eyebrows and bullets and never sets body text.
  // A 3px rule over the card that means "things needing you" is exactly that.
  SECTION_ACTION_ITEMS: "var(--sig-section-action-items, #FF6B00)",
  SECTION_SCHEDULE: "var(--sig-section-schedule, #00B3B3)",
  SECTION_CLIENTS: "var(--sig-section-clients, #009BFF)",
  SECTION_PROSPECTS: "var(--sig-section-prospects, #B6F2F8)",
  SECTION_SIGNALS: "var(--sig-section-signals, #FFEEDC)",
  GOLD_BG: "var(--sig-gold-bg, rgba(212,164,68,0.22))",
  ERROR: "var(--sig-error, rgba(255,120,120,0.95))",
  // Teal, not green: SUCCESS joined the brand family 2026-09-28.
  SUCCESS: "var(--sig-success, #2DD4BF)",
  SUCCESS_BG: "var(--sig-success-bg, rgba(45,212,191,0.10))",
  WARNING_BG: "var(--sig-warning-bg, rgba(254,176,106,0.08))",
  ERROR_BG: "var(--sig-error-bg, rgba(255,120,120,0.08))",

  // Near-black ink for text sitting ON a bright accent fill, where TEXT (a
  // white at 92%) would vanish. The value was already the de-facto convention
  // in btnPrimary and ~30 call sites; naming it is what stops the next one
  // being typed from memory.
  INK_ON_ACCENT: "var(--sig-ink-on-accent, #04060F)",
  /** Ink for text on a filled ERROR surface, where INK_ON_ACCENT reads too blue. */
  INK_ON_ERROR: "var(--sig-ink-on-error, #1a0505)",

  // Accent borders at a common strength, so a tinted edge reads the same
  // weight whichever accent it is drawn in. The two stronger warm steps exist
  // because the profile deliberately escalates: a soft edge invites, a stronger
  // one on the featured field says "this is the one that matters".
  ORANGE_BORDER: "var(--sig-orange-border, rgba(254,176,106,0.35))",
  ORANGE_BORDER_MED: "var(--sig-orange-border-med, rgba(254,176,106,0.45))",
  ORANGE_BORDER_STRONG: "var(--sig-orange-border-strong, rgba(254,176,106,0.55))",
  /** The faint halo under an attention surface: a glow, not an edge. */
  ORANGE_GLOW: "var(--sig-orange-glow, rgba(254,176,106,0.05))",
  /** Lift for a popup floating over the page. Depth, not a palette colour. */
  SHADOW_POPUP: "var(--sig-shadow-popup, 0 12px 32px rgba(0,0,0,0.45))",
  SUCCESS_BORDER: "var(--sig-success-border, rgba(45,212,191,0.35))",
  /** The red counterpart, at the same strength. Three call sites wrote
   *  rgba(255,120,120,0.35) by hand because this did not exist. */
  ERROR_BORDER: "var(--sig-error-border, rgba(255,120,120,0.35))",
  PINK_BORDER: "var(--sig-pink-border, rgba(236,72,153,0.35))",
  PINK_BG: "var(--sig-pink-bg, rgba(236,72,153,0.10))",
  ICE_BLUE_BORDER: "var(--sig-ice-blue-border, rgba(220,254,255,0.35))",
  ICE_BLUE_BG: "var(--sig-ice-blue-bg, rgba(220,254,255,0.10))",
  // Blue tints, previously written as literals at four strengths in ChangeStage.
  BLUE_BG: "var(--sig-blue-bg, rgba(81,173,229,0.10))",
  BLUE_BG_ON: "var(--sig-blue-bg-on, rgba(81,173,229,0.15))",
  BLUE_BORDER: "var(--sig-blue-border, rgba(81,173,229,0.35))",
  BLUE_BORDER_ON: "var(--sig-blue-border-on, rgba(81,173,229,0.40))",

  NAV_ACTIVE_BG: "var(--sig-nav-active-bg, rgba(254,176,106,0.08))",
  NAV_ACTIVE_BORDER: "var(--sig-nav-active-border, rgba(254,176,106,0.35))",
  NAV_DEFAULT_BG: "var(--sig-nav-default-bg, rgba(255,255,255,0.04))",

  // Table row states, deliberately ordered by strength so they stack rather
  // than compete. ROW_STRIPE is the base layer (zebra shading); the other three
  // are translucent OVERLAYS composited on top of it, so each reads the same on
  // a striped and an unstriped row. Keep the gaps between these values wide —
  // if the stripe creeps up toward the hover value the two stop being
  // distinguishable, which is the whole point of having both.
  ROW_STRIPE: "var(--sig-row-stripe, rgba(255,255,255,0.022))",   // barely-there lightening of the navy
  ROW_SELECTED: "var(--sig-row-selected, rgba(81,173,229,0.06))",   // persistent, must stay quieter than hover
  ROW_HOVER: "var(--sig-row-hover, rgba(255,255,255,0.055))",    // transient, follows the pointer
  ROW_FLASH: "var(--sig-row-flash, rgba(81,173,229,0.28))",      // just-changed; loudest, wins over all

  // ── INK THAT WANTS TO STAND OUT ─────────────────────────────────────────
  //
  // Separate from the brand accents above, and that separation is the whole
  // point. On the dark ground a heading in orange or a link in blue reads
  // well. On white the same hues measure 1.8 and 2.2, so they have to darken,
  // and a darkened brand colour is not the brand colour: #FF6B00 darkened far
  // enough to carry a word comes out brown.
  //
  // So the accents stay accents and never set text, and text that wants
  // emphasis takes these. Navy on light, which is the highest-contrast pairing
  // either theme has; the original hue on dark, so nothing changes there.
  /** A heading, a greeting, a numeral, a figure worth looking at. */
  INK_EMPHASIS: "var(--sig-ink-emphasis, #FEB06A)",
  /** Interactive text: a link, a tab, a control label. */
  INK_LINK: "var(--sig-ink-link, #51ADE5)",

  GRAD_PRIMARY: "var(--sig-grad-primary, linear-gradient(90deg, #FEB06A, #51ADE5))",
  GRAD_PROFILE: "var(--sig-grad-profile, linear-gradient(90deg, #51ADE5, #218C8C, #FEB06A))",
  GRAD_PERSONA: "var(--sig-grad-persona, linear-gradient(90deg, #FEB06A, #f97316, #51ADE5))",
} as const

// Pipeline phase palette. Stages are coloured by PHASE GROUP, never one colour
// per stage — 11 colours is noise; the groups are what a reader actually scans
// for. This is the same grouping the dashboard funnel uses, so the two surfaces
// stay coherent. The stage→phase mapping itself lives beside STAGE_LABELS in
// app/dashboard/network/vocab.ts, so there is exactly one source of truth.
//
// `bg` is a TINT, composited over an opaque base by pillStyle() rather than
// painted straight onto the row. That holds text contrast identical on a
// striped row, an unstriped row, a hovered row and a just-flashed row —
// otherwise the 0.28 ROW_FLASH overlay bleeds through and the label washes out.
// `alive` and `won` read their fg from T rather than restating a hex, so a
// meaning that is shared with the rest of the product is shared by construction
// and not by two hexes happening to agree.
//
// The two greens are DELIBERATE and not a duplication: `alive` is "they
// responded", `momentum` is "we actually spoke", a two-step progression within
// the same good news, which is why they are adjacent in hue as well as in the
// funnel. Collapsing them would lose the step that matters most to a user.
export const PHASE = {
  idle:     { fg: "rgba(255,255,255,0.62)", bg: "rgba(255,255,255,0.10)" }, // not started
  active:   { fg: T.WRN_BLUE,               bg: "rgba(81,173,229,0.20)"  }, // in progress
  alive:    { fg: T.SUCCESS,                bg: "rgba(0,179,179,0.16)"   }, // replied
  momentum: { fg: "#a7f3d0",                bg: "rgba(16,185,129,0.34)"  }, // chat booked/done
  longgame: { fg: "#c4b5fd",                bg: "rgba(167,139,250,0.22)" }, // nurture / ask
  won:      { fg: T.GOLD,                   bg: T.GOLD_BG               }, // outcome: ACHIEVED, not urgent
  resting:  { fg: "rgba(255,150,150,0.78)", bg: "rgba(255,120,120,0.14)" }, // dormant
} as const

export type PhaseKey = keyof typeof PHASE

export function pillStyle(phase: PhaseKey): React.CSSProperties {
  const p = PHASE[phase]
  return {
    color: p.fg,
    background: `linear-gradient(${p.bg}, ${p.bg}), ${T.CARD}`,
    border: `1px solid ${p.bg}`,
  }
}

export const input: React.CSSProperties = {
  background: T.GLASS,
  border: `1px solid ${T.BORDER}`,
  borderRadius: 12,
  color: T.TEXT,
  height: 44,
  padding: "0 14px",
  fontSize: TYPE.control,
  width: "100%",
  outline: "none",
}

export const textarea: React.CSSProperties = {
  ...input,
  height: "auto",
  padding: "12px 14px",
  lineHeight: "20px",
  resize: "vertical",
}

// Native <select> on the glass input background renders unreadable (dark text on
// dark, or the OS default popup). Force white background + navy text so the
// closed control and the option list are legible in both browser themes.
// Pair with `selectOption` on each <option> so the open list matches.
export const select: React.CSSProperties = {
  ...input,
  background: "#ffffff",
  color: T.BG,
  cursor: "pointer",
}
export const selectOption: React.CSSProperties = {
  background: "#ffffff",
  color: T.BG,
}

// The dark pair, for the Coaches Center and every other screen still on the
// dark shell. White text on the card ground, matching the page rather than
// punching a white rectangle into it.
//
// BOTH HALVES ARE REQUIRED, and forgetting the option half is what made the
// Tasks filters unreadable. Styling only the <select> sets the colour of the
// closed control AND is inherited by the options, but the popup's BACKGROUND
// comes from the browser, which paints it white unless told otherwise. The
// result is white text on white: the list looks empty until you arrow through
// it. colorScheme:"dark" asks the browser for a dark popup and most of the
// time gets one, but it is a hint, not a guarantee, and it does nothing at all
// when the OS or the browser is in light mode. So the option carries its own
// background and always has.
// The colours alone, for layering onto a control that already has its own
// geometry. Several screens define a local `input` at their own height and
// font size, and spreading the full `selectDark` over one of those would
// silently resize it: a 12px control in a table row would come back 44px tall.
export const selectDarkInk: React.CSSProperties = {
  background: T.CARD,
  color: T.TEXT,
  colorScheme: "dark",
  cursor: "pointer",
}
export const selectDark: React.CSSProperties = {
  ...input,
  ...selectDarkInk,
  border: `1px solid ${T.BORDER}`,
}
export const selectDarkOption: React.CSSProperties = {
  background: T.CARD,
  color: T.TEXT,
}

// Small caption above a control, naming the FIELD so the control's value is not
// mistaken for the field name. Shared so every labelled control looks identical.
// Pair with FIELD_LABELS for the text.
export const fieldLabel: React.CSSProperties = {
  color: T.MUTED,
  fontSize: TYPE.label,
  fontWeight: 800,
  letterSpacing: 0.3,
  whiteSpace: "nowrap",
}
export const fieldWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
}

// THE TWO SHARED BUTTONS, raised to the scale once rather than per screen.
// 13px labels in 44px of padding read as small print inside a large target,
// which is the worst of both. minHeight holds the 40px floor and the label
// meets it. See TYPE and SPACE in lib/theme/surfaces.ts.
export const btnPrimary: React.CSSProperties = {
  background: T.GRAD_PRIMARY,
  color: "var(--sig-ink-on-primary, #04060F)",
  fontWeight: 900,
  borderRadius: 12,
  minHeight: SPACE.control,
  padding: "0 20px",
  fontSize: TYPE.control,
  border: "none",
  cursor: "pointer",
}

export const btnSecondary: React.CSSProperties = {
  background: T.NAV_DEFAULT_BG,
  border: `1px solid ${T.BORDER_SOFT}`,
  color: T.TEXT,
  fontWeight: 900,
  borderRadius: 12,
  minHeight: SPACE.control,
  padding: "0 20px",
  fontSize: TYPE.control,
  cursor: "pointer",
}

export const card: React.CSSProperties = {
  borderRadius: 18,
  border: `1px solid ${T.BORDER_SOFT}`,
  background: T.CARD,
  overflow: "hidden",
}

export const eyebrow: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 2,
  textTransform: "uppercase",
}

export const headline: React.CSSProperties = {
  fontSize: TYPE.title,
  fontWeight: 950,
  letterSpacing: -0.5,
  color: T.TEXT,
}

export const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 0.5,
}
