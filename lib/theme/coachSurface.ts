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
export const COACH_SURFACE: "dark" | "light" = "dark"

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
  SUCCESS_BG: "#DFF5E6",
  WARNING_BG: "#FFEEDC",
  ERROR_BG: "#FBE4E3",
  PINK_BG: "#FDE3EC",
  ICE_BLUE_BG: "#E4FBFC",
  BLUE_BG: "#DCEDF9",
  BLUE_BG_ON: "#C7E3F6",
  ORANGE_GLOW: "#FFF6EC",

  // ── Borders on those fills ──
  GOLD_BORDER: "#E0C173",
  SUCCESS_BORDER: "#8FD9A6",
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
  SUCCESS: "#1B7A72",
  // WRN_ORANGE sets text in a dozen places on the dark ground. On white it
  // measures 1.8, so the TOKEN takes the darkened ink and the brand orange
  // stays on SECTION_ACTION_ITEMS and TASK_OVERDUE, which draw rules and
  // chips rather than words.
  WRN_ORANGE: "#8A3D00",
  // Same rule, same reason: #51ADE5 is 2.2 on white.
  WRN_BLUE: "#00569A",
  WRN_TEAL: "#00757A",
  GOLD: "#8A6410",
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
 * The CSS that puts the light palette on a subtree.
 *
 * Scoped to an attribute rather than a class so it cannot collide with
 * anything, and emitted as a plain string so the shell can drop it in a
 * `<style>` without a build step.
 */
export function lightCoachSurfaceCss(selector = '[data-coach-surface="light"]'): string {
  const decls = Object.entries(LIGHT_COACH_VARS)
    .map(([token, value]) => `  ${cssVar(token)}: ${value};`)
    .join("\n")
  return `${selector} {\n${decls}\n}`
}
