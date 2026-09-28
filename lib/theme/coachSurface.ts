// lib/theme/coachSurface.ts
//
// HOW THE COACHES CENTER CHANGES THEME WITHOUT CHANGING 1,493 CALL SITES.
//
// The Coaches Center reads its colours from `T` in lib/dashboard-theme.ts:
// 56 tokens, referenced 1,493 times across roughly 60 files. Converting it to
// the light theme by editing call sites means touching every one of them, in a
// diff nobody can review, with no way to go back.
//
// So `T` stops being hexes and becomes CSS custom properties. Every token is
// `var(--sig-NAME, <the original dark value>)`. Nothing about how a component
// is written changes: `background: T.CARD` still works, still type-checks, and
// still renders the dark navy when no variable is set. The FALLBACK is the
// safety line: if this module never loads, or a page is outside the shell, the
// Coaches Center looks exactly as it does today.
//
// A surface then decides the palette by setting those variables on a wrapper.
// One rule in one place flips a whole page, and un-flips it just as fast.
//
// WHAT THIS DOES NOT SOLVE. A variable can change what `T.CARD` evaluates to;
// it cannot change a component that hard-codes "rgba(255,255,255,0.02)" inline,
// and the Coaches Center has plenty of those. Those are the per-page fixes, and
// they are visible precisely because the ground moved under them. That is the
// intended order: flip the ground, then fix what the ground exposes.

import { T } from "../dashboard-theme"

/**
 * Which palette the Coaches Center is on.
 *
 * Flip to "light" to repaint every page under /dashboard/coach. Nothing else
 * changes: components keep reading `T`, and `T` keeps meaning whatever the
 * shell says it means.
 *
 * IT LIVES HERE RATHER THAN IN THE LAYOUT because a Next.js route file may
 * only export `default` and a fixed set of route options; anything else fails
 * the build. Which is a better home anyway: the switch belongs beside the
 * palette it switches to.
 */
export const COACH_SURFACE: "dark" | "light" = "light"

/** The variable name for a token. Prefixed, because these are global. */
export const cssVar = (token: string) => `--sig-${token.toLowerCase().replace(/_/g, "-")}`

/**
 * The light values, by token name.
 *
 * ONLY THE STRUCTURAL TOKENS ARE HERE. The brand accents (WRN_ORANGE,
 * TASK_DONE, the section identities) are the same colour in both themes, which
 * is the point of a brand palette; a token absent from this map keeps its dark
 * value on both grounds. Where an accent needs to change ROLE rather than hue,
 * it is listed and commented.
 *
 * Contrast measured on #FFFFFF (card) and #EAF5FA (the light ground's flat
 * equivalent), the same two surfaces lib/theme/surfaces.ts is measured against.
 */
export const LIGHT_COACH_VARS: Record<string, string> = {
  // ── The ground and its planes ──
  // The page is the same radial the converted JobFit surfaces use, so a coach
  // moving between the two does not cross a seam.
  BG: "#EAF5FA",
  NAV_BG: "#FFFFFF",
  CARD: "#FFFFFF",
  // GLASS was a white veil over navy. On white it has to be a navy veil, or
  // every inset panel disappears.
  GLASS: "rgba(19,41,74,0.035)",
  BORDER: "#DCE6EF",
  BORDER_SOFT: "#E8EFF5",

  // ── Ink ──
  // The same three ranks as surfaces.ts LIGHT, so the two systems agree:
  // 13.0, 7.3 and 6.5 on white. DIM is the one that had to move furthest: it
  // was 35% white, decorative on navy and invisible on paper.
  TEXT: "#13294A",
  MUTED: "#46607A",
  DIM: "#6B829B",

  // ── Row overlays ──
  // Dark alphas, the mirror of the dark theme's white ones, and the same
  // precedence: flash beats hover beats selected beats stripe.
  ROW_STRIPE: "rgba(19,41,74,0.030)",
  ROW_SELECTED: "rgba(0,155,255,0.09)",
  ROW_HOVER: "rgba(19,41,74,0.055)",
  ROW_FLASH: "rgba(0,155,255,0.20)",

  // ── Navigation ──
  // The active item was an orange wash on navy. On white that wash is nearly
  // invisible, so the active state becomes the peach tint at full strength
  // with a real border.
  NAV_ACTIVE_BG: "#FFEEDC",
  NAV_ACTIVE_BORDER: "#FF6B00",
  NAV_DEFAULT_BG: "#FFFFFF",

  // ── Tinted fills ──
  // Each was a low-alpha wash designed to read on navy. On white the same
  // alpha is imperceptible, so each becomes a solid tint at the same meaning.
  GOLD_BG: "#F7EBCC",
  SUCCESS_BG: "#D6EFEC",
  WARNING_BG: "#FFEEDC",
  ERROR_BG: "#FBE4E3",
  PINK_BG: "#FDE3EC",
  ICE_BLUE_BG: "#E4FBFC",
  BLUE_BG: "#DCEDF9",
  BLUE_BG_ON: "#C7E3F6",
  ORANGE_GLOW: "#FFF6EC",

  // ── Borders on those fills ──
  GOLD_BORDER: "#E0C173",
  SUCCESS_BORDER: "#7FCDCD",
  PINK_BORDER: "#F3A8C4",
  ICE_BLUE_BORDER: "#9FD9DD",
  BLUE_BORDER: "#9FCBEA",
  BLUE_BORDER_ON: "#7BB8E2",
  ORANGE_BORDER: "#FFC08A",
  ORANGE_BORDER_MED: "#FFA45C",
  ORANGE_BORDER_STRONG: "#FF8A33",

  // ── Words that carry meaning ──
  // ERROR was rgba(255,120,120,0.95): 2.3 on white, unreadable. The ink from
  // surfaces.ts LIGHT measures 5.9.
  ERROR: "#C0322F",
  // SUCCESS IS TEAL, NOT GREEN. It was #4ade80 on dark and a green-teal on
  // light, off the palette in both. The brand teal #00B3B3 fills chips, icons
  // and rails; a word takes #00757A, the darkened teal, at 5.49 on a card.
  // ERROR stays red, because red means wrong and the hue IS the meaning.
  SUCCESS: "#00757A",
  // THE ACCENTS STAY ACCENTS AND NEVER SET TEXT.
  //
  // These were briefly darkened so they could carry a word: #FF6B00 became
  // #8A3D00, which is brown. A darkened brand colour is not the brand colour,
  // and a greeting in brown is not emphasis, it is a mistake that looks
  // deliberate. They take their brand values here and draw rules, chips,
  // icons and eyebrows; INK_EMPHASIS and INK_LINK carry the words.
  WRN_ORANGE: "#FF6B00",
  WRN_BLUE: "#009BFF",
  WRN_TEAL: "#00B3B3",
  GOLD: "#D4A444",

  // Navy, the highest-contrast pairing either theme has.
  "ink-emphasis": "#08203F",
  "ink-link": "#08203F",
  // TASK_OPEN was near-white ice, an outline on navy. On white it needs to be
  // the ink, not the tint.
  TASK_OPEN: "#00757A",
  TASK_HEADER: "#00569A",

  // ── Ink on a filled thing ──
  // Unchanged in value but worth saying: a filled accent is still dark-on-light
  // or white-on-dark depending on the accent, and every fill in the Coaches
  // Center uses a light tint, so the ink stays navy.
  INK_ON_ACCENT: "#FFFFFF",

  // ── Depth ──
  // A black shadow on a blue ground reads as dirt. Navy-tinted, like
  // surfaces.ts.
  SHADOW_POPUP: "0 12px 32px rgba(19,41,74,0.18)",

  // ── Gradients ──
  // A PRIMARY ACTION IS SOLID NAVY on light. The peach-to-blue gradient is a
  // dark-ground device; on white it is a pale smear with no contrast for its
  // own label. This is the same decision surfaces.ts LIGHT made for `action`.
  GRAD_PRIMARY: "linear-gradient(#08203F, #08203F)",
  GRAD_PROFILE: "linear-gradient(90deg, #00569A, #00757A, #8A3D00)",
  GRAD_PERSONA: "linear-gradient(90deg, #8A3D00, #C0322F, #00569A)",
}

/**
 * The pieces that are not `T` tokens but had exactly the same problem.
 *
 * Each was a hand-written pair designed for navy, and each measured under
 * 3:1 against a white card once the ground flipped. They become variables
 * for the same reason the tokens did: so the value follows the ground
 * instead of the component having to know which ground it is on.
 *
 * Named by ROLE rather than by file, because five separate files carried
 * their own copy of the same five avatar colours.
 */
export const LIGHT_COACH_EXTRAS: Record<string, string> = {
  // Avatar initials. The wash was 18% alpha over navy; on white the same
  // wash is almost nothing and the pale ink measured 1.0 to 1.5 against the
  // card. Solid tint, ink dark enough to carry two letters.
  "avatar-0-bg": "#DCEDF9", "avatar-0-ink": "#00569A",
  "avatar-1-bg": "#FFEEDC", "avatar-1-ink": "#8A3D00",
  "avatar-2-bg": "#EDE4F9", "avatar-2-ink": "#5B3392",
  "avatar-3-bg": "#FDE3EC", "avatar-3-ink": "#A3215B",
  "avatar-4-bg": "#D6EFEC", "avatar-4-ink": "#00757A",

  // Lifecycle pills. #F4A261 with white text is 2.1:1. On navy the
  // surround carried it; on white it is a pale badge with white letters.
  "pill-prospect-bg": "#FFEEDC", "pill-prospect-ink": "#8A3D00",
  "pill-active-bg": "#D6EFEC", "pill-active-ink": "#17706F",
  "pill-inactive-bg": "#DCEDF9", "pill-inactive-ink": "#00569A",
  "pill-archived-bg": "#E9EEF4", "pill-archived-ink": "#3D5878",
  // The same orange as a NUMERAL on a white card rather than a chip fill.
  "pill-prospect-ink-on-card": "#8A3D00",

  // GRAD_PRIMARY is solid navy on light, so near-black ink on it is 1.2:1.
  "ink-on-primary": "#FFFFFF",
  // AND NOT THE OTHER WAY. --sig-ink-on-bright is the ink for the count pills
  // and the peach buttons, whose fills are bright on BOTH grounds. It stays
  // near-black: white on #B6F2F8 measures 1.2:1. The two were briefly one
  // variable and the prospect count went white on ice.
  "ink-on-bright": "#04060F",

  // The due chip. TASK_OVERDUE stays brand orange, because it draws the row
  // border and the chip fill and that is what orange is for. The WORD inside
  // the chip cannot be that orange: on the peach fill it measured 1.0.
  "chip-overdue-ink": "#8A3D00",
  "chip-due-ink": "#00569A",
  // A 14% wash over white is not a chip. 26% is.
  "chip-wash": "0.26",

  // The task-row avatars mix their hue toward navy rather than carrying
  // a second palette. 0% on dark, 34% on light, which is what takes the
  // palest member past 4.5:1 on its own wash.
  "avatar-darken": "34%",
  "avatar-wash": "0.22",
}

/**
 * The dark values, read back out of `T` itself.
 *
 * DERIVED, NOT RETYPED. Every token in T is `var(--sig-x, <dark value>)`, so
 * the fallback IS the dark palette, and parsing it out means the two cannot
 * disagree. A hand-written copy would drift the first time somebody tuned a
 * hex in dashboard-theme.ts without thinking to look here.
 */
function darkVars(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [token, value] of Object.entries(T as unknown as Record<string, string>)) {
    const m = /^var\(--sig-[a-z-]+,\s*([\s\S]+)\)$/.exec(value)
    if (m) out[token] = m[1].trim()
  }
  return out
}

/** The extras are already CSS-variable names, so they skip cssVar(). */
function extraDecls(): string {
  return Object.entries(LIGHT_COACH_EXTRAS).map(([k, v]) => `  --sig-${k}: ${v};`).join("\n")
}

function declsFor(vars: Record<string, string>): string {
  return Object.entries(vars).map(([t, v]) => `  ${cssVar(t)}: ${v};`).join("\n")
}

/**
 * Both palettes, as two rules.
 *
 * THE DARK RULE EXISTS SO A DARK ISLAND CAN SIT INSIDE A LIGHT PAGE. Custom
 * properties inherit, so without it the nav would pick up the light values
 * from its ancestor and turn white. The nav is navy on BOTH grounds by
 * design: navy is structure, and it sits happily next to either ground. It
 * opts back out by carrying data-coach-surface="dark".
 *
 * Scoped to an attribute rather than a class so it cannot collide with
 * anything, and emitted as a plain string so the shell can drop it into a
 * `<style>` without a build step.
 */
export function coachSurfaceCss(): string {
  return [
    `[data-coach-surface="light"] {\n${declsFor(LIGHT_COACH_VARS)}\n${extraDecls()}\n}`,
    `[data-coach-surface="dark"] {\n${declsFor(darkVars())}\n}`,
  ].join("\n")
}

/** The light half alone, for a wrapper that only ever needs that. */
export function lightCoachSurfaceCss(selector = '[data-coach-surface="light"]'): string {
  return `${selector} {\n${declsFor(LIGHT_COACH_VARS)}\n}`
}
