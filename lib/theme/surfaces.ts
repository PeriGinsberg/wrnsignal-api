// Surfaces: the same meanings, on a dark card or a light one.
//
// Product-wide by design, not networking-only. A component takes a Surface and
// reads `s.meaning.attention.ink` rather than importing a fixed token, so a
// screen is themed by which Surface it is handed.
//
// WHY EVERY MEANING HAS THREE VALUES. No brand hue clears 4.5:1 as text on
// white. Measured: peach 1.81, blue 2.48, gold 2.28, pink 2.14, purple 3.09,
// red 3.91, teal 4.04, rose 4.02. So a meaning cannot be one hex on light. It
// is three, each with one job:
//
//   ink     the darkened value: status TEXT and the status DOT, both the same
//           value so a dot and its label match. Also rails-as-text, icons.
//   accent  the brand hue at full chroma: initial tiles, 3px group rails,
//           progress fills, orb gradients. Structural colour, never text.
//   fill    the pale tint: chips and soft backgrounds, always with its own
//           ink on top.
//
// Pairs that collapse as two inks never meet as two inks. A status is a dot
// plus text; a group identity is a rail of accent. That is the shape rule from
// COLOR-SYSTEM.md section 2, and it carries more weight on light than on dark.
// Every value below was computed against its own surface, not judged by eye.
//
// A PRIMARY ACTION IS SOLID NAVY. On light, `action.fill` is #08203F with white
// ink at 16.30:1, and nothing else on a light screen is a filled navy button, so
// "what do I click" stays unmistakable. This replaced a peach gradient: the brand
// rule is that a primary button is solid navy and orange is reserved for rules,
// section numbers, eyebrow labels and bullets, never a button fill.
//
// PEACH IS NOT REMOVED FROM THE LIGHT THEME, and a hex-level sweep for #FEB06A
// would be wrong. It still carries `orb.peach`, `hero.accent`, and the warm glow
// in `hero.background` — structural colour, none of it a button. What changed is
// only that peach no longer means "press this". Peach is also still unreachable
// through `meaning`, so a status lookup cannot return an action colour and the
// separation stays structural rather than a convention someone has to remember.
//
// The attention MEANING is coral (#F26B52), a warm neighbour 21.8 dE from peach
// but not the same hex — see section 6.11. It is warm, it is not peach, and it is
// not an action. See COLOR-SYSTEM.md section 6.9.
//
// `current` IS NOT A STATUS. It is the one meaning that marks a position rather
// than a state: where you are on a path, on a stepper. It is separate from
// `attention` (which was doing this job in rose's place) because "where you
// stand" and "something needs you" are different questions, and a screen can
// legitimately ask both at once.

import type { PhaseKey } from "../dashboard-theme"

export type MeaningKey =
  | "attention" | "current" | "replied" | "spoke" | "done" | "progress"
  | "sequence" | "linkedin" | "longgame" | "dormant" | "error" | "idle"

export type Meaning = {
  /** Status text and the status dot. Clears 4.5:1 on card, page and well. */
  ink: string
  /** The brand hue at full chroma. Tiles, rails, progress fills. Never text. */
  accent: string
  /** Pale tint for chips and soft backgrounds, always with its own ink on top. */
  fill: string
}

/** Row-state overlays. Composited over the row base, loudest last. */
export type RowOverlays = { stripe: string; hover: string; selected: string; flash: string }

/** Elevation. On light, cards separate from the ground by shadow, not by tint. */
export type Shadows = { card: string; raised: string }

/**
 * The one action shape. Peach on light, the warm gradient on dark. Two tiers:
 * `primary` is do-this-now (filled), `optional` is an available-but-not-urgent
 * outline. A third tier, no button at all, is the absence of this token.
 */
export type Action = {
  fill: string
  ink: string
  glow: string
  outlineBorder: string
  outlineInk: string
  /** Quiet inline links such as "Show me" or "Reply". Not a button. */
  quietInk: string
}

/** The navy panel. Structure on light, a raised card on dark. */
export type Hero = {
  background: string
  ink: string
  muted: string
  link: string
  /** Progress fills and marks inside the hero. */
  accent: string
}

export type Surface = {
  name: "dark" | "light"
  /** The app ground. A gradient on light, so apply it as `background`. */
  page: string
  /** Solid equivalent of `page`, for surfaces that cannot take a gradient. */
  pageFlat: string
  /** The base card. */
  card: string
  /**
   * A lifted card. Same colour as `card` on light: elevation is carried by
   * `shadow.raised`, not by brightness. See COLOR-SYSTEM.md section 6.2.
   */
  raised: string
  /** Recessed a step below the card: inputs. */
  well: string
  border: string
  borderSoft: string
  shadow: Shadows
  text: { primary: string; secondary: string; muted: string; dim: string }
  meaning: Record<MeaningKey, Meaning>
  row: RowOverlays
  /** Ink for text sitting on a filled, saturated accent. */
  inkOnAccent: string
  action: Action
  hero: Hero
  /**
   * Orb buttons: gradient fill, inner glow, coloured drop shadow. Colour by
   * meaning: teal scores, blue tracks, peach networks. Each ink clears 4.5:1
   * at EVERY gradient stop, not just the average, because text sits across the
   * whole sweep.
   */
  orb: Record<"peach" | "blue" | "teal", { fill: string; ink: string; glow: string }>
  /**
   * DEAD ON LIGHT, retained on dark. Both of these were compatibility aliases
   * for callers not yet moved to `action`, and a repo-wide grep found no such
   * caller in any theme. LIGHT drops them; DARK still declares them, so they
   * are optional rather than deleted outright. Do not add new consumers — use
   * `action` / `action()`.
   */
  primaryButton?: { background: string; color: string }
  gradient: {
    /** The TODAY panel: deep navy with a warm glow off the top right. */
    hero: string
    /** The act-now button on a hero card. Dead on light; see `primaryButton`. */
    warmAction?: string
  }
}

// The lift under a raised card. Hoisted because the primary button reuses it as
// its shadow, and the two must not drift: a navy button and a lifted card should
// sit in the same light.
const LIGHT_RAISED_SHADOW =
  "0 2px 4px rgba(19,41,74,0.05), 0 10px 28px rgba(19,41,74,0.10)"

export const LIGHT: Surface = {
  name: "light",
  // The ground lightens. Navy is now structure only: nav, heroes, tiles. This
  // settles the open question in COLOR-SYSTEM.md section 6.8.
  page: "radial-gradient(120% 120% at 50% 0%, #f0f9fc 0%, #e6f4f9 100%)",
  pageFlat: "#EAF5FA",
  // Cards are white and lifted by shadow. White against the ground is a 1.13:1
  // step on purpose: the separation is elevation, which keeps the ground calm.
  card: "#FFFFFF",
  raised: "#FFFFFF",
  well: "#F4F8FB",
  border: "#DCE6EF",
  borderSoft: "#E8EFF5",
  // Navy tinted, never black. A black shadow on a blue ground reads as dirt.
  shadow: {
    card: "0 1px 2px rgba(19,41,74,0.04), 0 4px 12px rgba(19,41,74,0.06)",
    raised: LIGHT_RAISED_SHADOW,
  },
  // Primary text is the structural navy itself, which is what keeps the two
  // themes reading as one product rather than two apps. `muted` is #526C87
  // rather than the earlier #5E7A99, which measured 3.96 on the ground.
  text: { primary: "#13294A", secondary: "#3D5878", muted: "#526C87", dim: "#8299B3" },
  meaning: {
    // Coral. "Something needs you": overdue, unfilled, not set, act here.
    //
    // Amber held this role until 2026-08-04 and had one structural problem:
    // it was the SAME HUE as the action colour, so "act on this" and "press
    // this" were the same warmth, separated only by shape. Coral separates
    // them by hue as well, 21.8 dE from peach.
    //
    // WHERE IT SITS NEXT TO ERROR RED, the one pairing that matters, because
    // "needs you" and "destructive" must never read alike: the ACCENTS measure
    // 9.7 dE apart, which is distinguishable side by side but is the closest
    // pair in the system. The INKS, which is what carries text, are 11.3 apart,
    // and the two never appear in the same shape (see COLOR-SYSTEM 6.11).
    attention: { ink: "#884133", accent: "#F26B52", fill: "#FBE3D6" },
    // Rose. The ring on a stepper's current step, and the label under it.
    //
    // The ink is NOT a plain darkening of the accent, and the reason is worth
    // keeping: rose and the linkedin pink sit on the SAME hue, 336. Darkening
    // #E5397E far enough to clear 4.5:1 lands it on top of the linkedin ink
    // #C2185B, which is itself a darkened rose. Measured, a straight darken
    // came out 3.6 dE2000 from it, which is "same colour, slightly off" and
    // not a difference anyone would name. Since hue cannot separate two hues
    // that are equal, lightness does: #93245F is 10.7 dE from the linkedin
    // ink, still reads as rose (hue 328), and measures 7.02 on the worst
    // ground. The accents were never the problem, 17.5 dE apart.
    current: { ink: "#93245F", accent: "#E5397E", fill: "#FBDCEB" },
    replied: { ink: "#17706F", accent: "#218C8C", fill: "#D6EFEC" },
    spoke: { ink: "#0F5C55", accent: "#1B7A72", fill: "#CDEAE4" },
    done: { ink: "#8A6410", accent: "#D4A444", fill: "#F7EBCC" },
    progress: { ink: "#1F6FA8", accent: "#51ADE5", fill: "#DCEDF9" },
    sequence: { ink: "#0F6478", accent: "#DCFEFF", fill: "#DCFEFF" },
    linkedin: { ink: "#C2185B", accent: "#FF8FB0", fill: "#FDE3EC" },
    longgame: { ink: "#7B3FB5", accent: "#B679E0", fill: "#EDE4F9" },
    dormant: { ink: "#6E5C79", accent: "#A98FB8", fill: "#EFEAF3" },
    error: { ink: "#C0322F", accent: "#E5484D", fill: "#FBE4E3" },
    idle: { ink: "#4E6B88", accent: "#D3DCE6", fill: "#E9EEF4" },
  },
  // Dark alphas, the mirror of the dark theme's white ones. Same precedence and
  // the same rule that the gaps stay wide enough to tell apart.
  row: {
    stripe: "rgba(19,41,74,0.030)",
    selected: "rgba(31,111,168,0.10)",
    hover: "rgba(19,41,74,0.055)",
    flash: "rgba(31,111,168,0.20)",
  },
  inkOnAccent: "#FFFFFF",
  // A PRIMARY ACTION IS SOLID NAVY: #08203F, white ink at 16.30:1 — the highest
  // contrast pairing in either theme.
  //
  // This supersedes the peach gradient (#FEB06A to #F0913F with navy ink at
  // 6.11). The brand rule is that a primary button is solid navy, and orange is
  // reserved for rules, section numbers, eyebrow labels and bullets — never a
  // button fill and never body text. Peach never measured well on white anyway:
  // 1.81 as text, and `outlineBorder` had already been pushed off the gradient's
  // dark end to #DE7620 just to clear the 3.0 a boundary needs.
  //
  // The ink is white and cannot be the navy the peach tier used: #13294A on
  // #08203F is 1.12:1, invisible. The glow is the card's own raised shadow, so a
  // button and a lifted card sit in the same navy-tinted light.
  action: {
    fill: "#08203F",
    ink: "#FFFFFF",
    glow: LIGHT_RAISED_SHADOW,
    // THE OPTIONAL TIER IS STILL PEACH, and it took a structural fix to get
    // there rather than a new hex.
    //
    // `outlineInk` was #95500E, a darkened peach, and it read as amber — which
    // was the whole problem: every other action on a screen was peach, and the
    // one outline button was brown. But the ink cannot simply be "more peach".
    // Peach measures 1.81 as text on white, so an outline label has to be
    // darkened to clear 4.5:1, and #95500E was ALREADY peach's own hue (29°) at
    // 83% saturation. Every candidate at that hue with usable contrast comes
    // out brown; that is what darkening an orange does. Measured across a
    // 500-candidate sweep, no exception.
    //
    // So the peach moves to where peach can actually live at full chroma — the
    // BORDER — and the label takes navy. The tiers differ by fill versus
    // border, which is what a tier should mean.
    //
    // The border deepens one stop past the gradient's dark end because #F0913F
    // measures 2.38 on white, under the 3.0 a non-text boundary needs. #DE7620
    // is the same hue family at 3.13.
    //
    // LEFT UNCHANGED when the filled tier went navy, deliberately. The only
    // consumer of these two tokens is app/dashboard/network/profile/Field.tsx,
    // where they paint a featured-field border and a pill badge — neither of
    // them a button. Renavying the optional tier would repaint a non-button, so
    // the two tiers no longer share an ink: filled is white on navy, outline is
    // navy on white. Revisit if a real outline BUTTON ever appears.
    outlineBorder: "#DE7620",
    outlineInk: "#13294A",
    quietInk: "#1F6FA8",
  },
  hero: {
    background:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.16), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #1B3A63 0%, #13294A 55%, #0E1F38 100%)",
    ink: "#FFFFFF",
    muted: "#9DB6D0",
    link: "#7FC4EC",
    accent: "#FEB06A",
  },
  // Peach and blue stay light and take navy ink. Teal is the one saturated orb
  // and takes white. Worst stop: peach 6.11, blue 5.24, teal 5.16.
  orb: {
    peach: {
      fill: "linear-gradient(135deg, #FEB06A, #F0913F)",
      ink: "#13294A",
      glow: "0 2px 6px rgba(240,145,63,0.28), 0 10px 26px rgba(240,145,63,0.20)",
    },
    blue: {
      fill: "linear-gradient(135deg, #7FC8EF, #4FA3D8)",
      ink: "#13294A",
      glow: "0 2px 6px rgba(79,163,216,0.28), 0 10px 26px rgba(79,163,216,0.20)",
    },
    teal: {
      fill: "linear-gradient(135deg, #1B7A72, #16605C)",
      ink: "#FFFFFF",
      glow: "0 2px 6px rgba(22,96,92,0.30), 0 10px 26px rgba(22,96,92,0.22)",
    },
  },
  // `primaryButton` and `gradient.warmAction` are gone from light. Both were
  // peach-gradient aliases with zero consumers repo-wide; keeping them would
  // have left two stale copies of a value the theme no longer uses. Use
  // `action` / `action()`.
  gradient: {
    hero:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.16), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #1B3A63 0%, #13294A 55%, #0E1F38 100%)",
  },
}

// Kept whole, not deleted. Light is the theme the product ships; dark stays
// dormant so a toggle remains possible. Every value that existed before is
// unchanged. `accent` is set to each meaning's existing ink, and the new
// `shadow` / `action` / `hero` / `orb` blocks restate values dark already used,
// so nothing about dark renders differently.
export const DARK: Surface = {
  name: "dark",
  page: "#13294A",
  pageFlat: "#13294A",
  card: "#0F1F38",
  raised: "#16294a",
  well: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.12)",
  borderSoft: "rgba(255,255,255,0.08)",
  shadow: {
    card: "0 1px 2px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.28)",
    raised: "0 2px 4px rgba(0,0,0,0.34), 0 10px 28px rgba(0,0,0,0.36)",
  },
  text: {
    primary: "rgba(255,255,255,0.92)",
    secondary: "rgba(255,255,255,0.75)",
    muted: "rgba(255,255,255,0.60)",
    dim: "rgba(255,255,255,0.35)",
  },
  meaning: {
    // Coral here too. The ink is lifted to #FF9B80 because #F26B52 measures
    // 3.82 against the lightest navy stop, under the bar for text.
    attention: { ink: "#FF9B80", accent: "#F26B52", fill: "rgba(242,107,82,0.10)" },
    // The one meaning dark did not already have. The accent is the same rose;
    // the ink is lifted to #FF6BA3 because #E5397E measures 3.60 on the navy
    // card, under the bar. 5.44 at the worst dark ground.
    current: { ink: "#FF6BA3", accent: "#E5397E", fill: "rgba(229,57,126,0.14)" },
    replied: { ink: "#4ade80", accent: "#4ade80", fill: "rgba(74,222,128,0.16)" },
    spoke: { ink: "#a7f3d0", accent: "#a7f3d0", fill: "rgba(16,185,129,0.34)" },
    done: { ink: "#D4A444", accent: "#D4A444", fill: "rgba(212,164,68,0.22)" },
    progress: { ink: "#51ADE5", accent: "#51ADE5", fill: "rgba(81,173,229,0.20)" },
    sequence: { ink: "#DCFEFF", accent: "#DCFEFF", fill: "rgba(220,254,255,0.10)" },
    linkedin: { ink: "#EC4899", accent: "#EC4899", fill: "rgba(236,72,153,0.10)" },
    longgame: { ink: "#c4b5fd", accent: "#c4b5fd", fill: "rgba(167,139,250,0.22)" },
    dormant: { ink: "rgba(255,150,150,0.78)", accent: "rgba(255,150,150,0.78)", fill: "rgba(255,120,120,0.14)" },
    error: { ink: "rgba(255,120,120,0.95)", accent: "rgba(255,120,120,0.95)", fill: "rgba(255,120,120,0.08)" },
    idle: { ink: "rgba(255,255,255,0.62)", accent: "rgba(255,255,255,0.62)", fill: "rgba(255,255,255,0.10)" },
  },
  row: {
    stripe: "rgba(255,255,255,0.022)",
    selected: "rgba(81,173,229,0.06)",
    hover: "rgba(255,255,255,0.055)",
    flash: "rgba(81,173,229,0.28)",
  },
  inkOnAccent: "#04060F",
  action: {
    fill: "linear-gradient(90deg, #FEB06A, #51ADE5)",
    ink: "#04060F",
    glow: "0 2px 6px rgba(254,176,106,0.24), 0 8px 20px rgba(254,176,106,0.16)",
    outlineBorder: "rgba(254,176,106,0.30)",
    outlineInk: "#FEB06A",
    quietInk: "#51ADE5",
  },
  hero: {
    background:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.10), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #16294a 0%, #0F1F38 60%, #0B182B 100%)",
    ink: "rgba(255,255,255,0.92)",
    muted: "rgba(255,255,255,0.60)",
    link: "#51ADE5",
    accent: "#FEB06A",
  },
  orb: {
    peach: {
      fill: "linear-gradient(135deg, #FEB06A, #f97316)",
      ink: "#04060F",
      glow: "0 2px 6px rgba(254,176,106,0.24), 0 10px 26px rgba(254,176,106,0.16)",
    },
    blue: {
      fill: "linear-gradient(135deg, #51ADE5, #218C8C)",
      ink: "#04060F",
      glow: "0 2px 6px rgba(81,173,229,0.24), 0 10px 26px rgba(81,173,229,0.16)",
    },
    teal: {
      fill: "linear-gradient(135deg, #218C8C, #0F5C55)",
      ink: "rgba(255,255,255,0.92)",
      glow: "0 2px 6px rgba(33,140,140,0.28), 0 10px 26px rgba(33,140,140,0.20)",
    },
  },
  primaryButton: { background: "linear-gradient(90deg, #FEB06A, #51ADE5)", color: "#04060F" },
  gradient: {
    hero:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.10), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #16294a 0%, #0F1F38 60%, #0B182B 100%)",
    warmAction: "linear-gradient(90deg, #FEB06A, #51ADE5)",
  },
}

/** The pipeline's phase groups, in Surface terms. One mapping, both themes. */
export const PHASE_MEANING: Record<PhaseKey, MeaningKey> = {
  idle: "idle",
  active: "progress",
  alive: "replied",
  momentum: "spoke",
  longgame: "longgame",
  won: "done",
  resting: "dormant",
}

/**
 * A status: a coloured dot plus text, both the meaning's ink so the mark and
 * its label match. This is the status SHAPE. Status is information, so it is
 * never a button and never a filled pill that looks tappable. The dot is
 * redundant coding: the text carries the meaning, which is why the dot can sit
 * below 3:1 without costing anyone the state.
 */
export function status(
  s: Surface,
  key: MeaningKey,
): { dot: React.CSSProperties; text: React.CSSProperties } {
  const ink = s.meaning[key].ink
  return {
    dot: {
      width: 8,
      height: 8,
      borderRadius: 999,
      background: ink,
      flexShrink: 0,
      display: "inline-block",
    },
    text: { color: ink, fontWeight: 700 },
  }
}

/**
 * A group identity: a 3px left rail of the meaning's accent. Passing null keeps
 * the identical inset via a transparent border, so headings stay aligned
 * whether or not a group is coloured.
 */
export function rail(s: Surface, key: MeaningKey | null): React.CSSProperties {
  return {
    borderLeft: `3px solid ${key ? s.meaning[key].accent : "transparent"}`,
  }
}

/**
 * The one action shape. `primary` is do-this-now and is the only place peach
 * appears as a fill; `optional` is available but not urgent. The third tier,
 * no action, is the absence of a button rather than a disabled one.
 */
export function action(s: Surface, tier: "primary" | "optional" = "primary"): React.CSSProperties {
  if (tier === "optional") {
    return {
      background: s.card,
      // 1.5px, not 1px. The border is the only thing carrying the action
      // colour in this tier, so it has to be seen; at 1px a 3.13 boundary is
      // technically compliant and practically a hairline.
      border: `1.5px solid ${s.action.outlineBorder}`,
      color: s.action.outlineInk,
      fontWeight: 800,
      cursor: "pointer",
    }
  }
  return {
    background: s.action.fill,
    border: "none",
    color: s.action.ink,
    boxShadow: s.action.glow,
    fontWeight: 800,
    cursor: "pointer",
  }
}

/** An orb button: gradient fill, coloured glow, ink that survives every stop. */
export function orb(s: Surface, key: "peach" | "blue" | "teal"): React.CSSProperties {
  const o = s.orb[key]
  return { background: o.fill, color: o.ink, boxShadow: o.glow, border: "none", cursor: "pointer" }
}

/** A card at rest, or lifted. On light the two differ by shadow, not colour. */
export function surfaceCard(s: Surface, lifted = false): React.CSSProperties {
  return {
    background: lifted ? s.raised : s.card,
    border: `1px solid ${s.borderSoft}`,
    boxShadow: lifted ? s.shadow.raised : s.shadow.card,
  }
}

/**
 * A filled pill: ink on its own fill.
 *
 * NOTE (2026-08-03): this is no longer the status shape on light. Status became
 * a dot plus text, see `status()` and COLOR-SYSTEM.md section 2. `pill()` is
 * retained for chips, counts and non-status labels, and because the dark theme
 * still uses pills for status. Do not reach for it to render a state on light.
 */
export function pill(s: Surface, key: MeaningKey): React.CSSProperties {
  const m = s.meaning[key]
  return {
    color: m.ink,
    // Two stops of the same colour give a flat layer that composites over the
    // card, so a pill reads the same on a striped row as an unstriped one.
    background: `linear-gradient(${m.fill}, ${m.fill}), ${s.card}`,
    border: `1px solid ${m.fill}`,
  }
}

/** Compose a row background: one overlay over the zebra base, loudest wins. */
export function rowBackground(
  s: Surface,
  base: string,
  o: { zebra: boolean; flash: boolean; hover: boolean; checked: boolean },
): string {
  const under = o.zebra ? `linear-gradient(${s.row.stripe}, ${s.row.stripe}), ${base}` : base
  const overlay = o.flash ? s.row.flash : o.hover ? s.row.hover : o.checked ? s.row.selected : null
  return overlay ? `linear-gradient(${overlay}, ${overlay}), ${under}` : under
}

/**
 * A phase-coloured initial tile, built on `accent` so the tile carries the
 * brand hue while its label stays legible. The sheen is a translucent white
 * overlay rather than a second hex per meaning, so any meaning can be tiled
 * without adding eleven more tokens to keep in sync.
 */
export function tile(s: Surface, key: MeaningKey): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, rgba(255,255,255,0.24), rgba(255,255,255,0)), ${s.meaning[key].accent}`,
    color: s.name === "light" ? "#FFFFFF" : s.inkOnAccent,
  }
}

/** The flat, deliberately colourless tile for a contact nobody has worked yet. */
export function tileIdle(s: Surface): React.CSSProperties {
  return { background: s.meaning.idle.fill, color: s.meaning.idle.ink }
}

/**
 * The structural navy tile: company initials on an application or contact card.
 * Navy is structure on light, so an active card's tile is navy rather than a
 * phase colour, matching the mockups.
 */
export function tileStructural(s: Surface): React.CSSProperties {
  return {
    background:
      s.name === "light"
        ? "linear-gradient(135deg, #1B3A63, #13294A)"
        : "linear-gradient(135deg, #16294a, #0F1F38)",
    color: "#FFFFFF",
  }
}
