// Surfaces: the same meanings, on a dark card or a light one.
//
// Product-wide by design, not networking-only. A component takes a Surface and
// reads `s.meaning.attention.ink` rather than importing a fixed token, so a
// screen is themed by which Surface it is handed.
//
// WHY EVERY MEANING HAS THREE VALUES. No brand hue clears 4.5:1 as text on
// white. Measured: peach 1.81, blue 2.48, gold 2.28, pink 2.14, purple 3.09,
// red 3.91, teal 4.04. So a meaning cannot be one hex on light. It is three,
// each with one job:
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
// PEACH IS ACTION, AND ONLY ACTION. On light, peach is not reachable through
// `meaning`. It lives in `action`, so a status lookup cannot return it and the
// rule is structural rather than a convention someone has to remember. The
// attention MEANING keeps a darkened peach ink for text such as "none yet" and
// overdue dates. See COLOR-SYSTEM.md section 6.9.

import type { PhaseKey } from "../dashboard-theme"

export type MeaningKey =
  | "attention" | "replied" | "spoke" | "done" | "progress"
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
  /** The primary button: retained for callers not yet moved to `action`. */
  primaryButton: { background: string; color: string }
  gradient: {
    /** The TODAY panel: deep navy with a warm glow off the top right. */
    hero: string
    /** The act-now button on a hero card. */
    warmAction: string
  }
}

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
    raised: "0 2px 4px rgba(19,41,74,0.05), 0 10px 28px rgba(19,41,74,0.10)",
  },
  // Primary text is the structural navy itself, which is what keeps the two
  // themes reading as one product rather than two apps. `muted` is #526C87
  // rather than the earlier #5E7A99, which measured 3.96 on the ground.
  text: { primary: "#13294A", secondary: "#3D5878", muted: "#526C87", dim: "#8299B3" },
  meaning: {
    attention: { ink: "#95500E", accent: "#FEB06A", fill: "#FDECD9" },
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
  // Navy on peach measures 6.11 at the darkest stop. The earlier light theme
  // made this button solid navy because peach also had to carry the attention
  // meaning and read washed out. Now that peach is action only, it works, and
  // the whole design hangs on it.
  action: {
    fill: "linear-gradient(135deg, #FEB06A, #F0913F)",
    ink: "#13294A",
    glow: "0 2px 6px rgba(240,145,63,0.28), 0 8px 20px rgba(240,145,63,0.18)",
    outlineBorder: "#F0913F",
    outlineInk: "#95500E",
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
  primaryButton: { background: "linear-gradient(135deg, #FEB06A, #F0913F)", color: "#13294A" },
  gradient: {
    hero:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.16), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #1B3A63 0%, #13294A 55%, #0E1F38 100%)",
    warmAction: "linear-gradient(135deg, #FEB06A, #F0913F)",
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
    attention: { ink: "#FEB06A", accent: "#FEB06A", fill: "rgba(254,176,106,0.08)" },
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
      border: `1px solid ${s.action.outlineBorder}`,
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
