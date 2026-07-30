// Surfaces: the same meanings, on a dark card or a light one.
//
// Product-wide by design, not networking-only. A component takes a Surface and
// reads `s.meaning.attention.ink` rather than importing a fixed token, so a
// screen is themed by which Surface it is handed.
//
// WHY EVERY MEANING HAS TWO VALUES. The dark palette separates several meanings
// by LIGHTNESS rather than hue. On white every colour has to darken to clear
// 4.5:1, which compresses the set into one narrow band and collapses exactly
// those pairs: in-progress blue against sequence ice measured a luminance ratio
// of 1.01, attention warm against done gold 1.06. Another round of hue-picking
// does not fix that. So:
//
//   ink   the dark value: text, rails, borders, icons
//   fill  the pale tint: pill and circle backgrounds, always with its own ink on top
//
// The pairs that collapse as two inks never meet as two inks. A status is ink on
// fill inside a pill; a group identity is a rail of ink. That is the shape rule
// from COLOR-SYSTEM.md §2, and it carries more weight on light than on dark.
// Every value below was computed against its own surface, not judged by eye.

import type { PhaseKey } from "../dashboard-theme"

export type MeaningKey =
  | "attention" | "replied" | "spoke" | "done" | "progress"
  | "sequence" | "linkedin" | "longgame" | "dormant" | "error" | "idle"

export type Meaning = { ink: string; fill: string }

/** Row-state overlays. Composited over the row base, loudest last. */
export type RowOverlays = { stripe: string; hover: string; selected: string; flash: string }

export type Surface = {
  name: "dark" | "light"
  page: string
  /** The base card. */
  card: string
  /** Brighter than `card`. What a lifted row sits on. */
  raised: string
  /** Recessed a step below the card: inputs. */
  well: string
  border: string
  borderSoft: string
  text: { primary: string; secondary: string; muted: string; dim: string }
  meaning: Record<MeaningKey, Meaning>
  row: RowOverlays
  /** Ink for text sitting on a filled, saturated accent. */
  inkOnAccent: string
  /** The primary button: solid, no gradient on light. */
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
  page: "#13294A",
  // Pure white is the RAISED state, not the base. An off-white base gives a
  // lifted row somewhere brighter to go, and takes the glare off a full page.
  card: "#F7F9FC",
  raised: "#FFFFFF",
  well: "#EDF1F7",
  border: "#D6DEE8",
  borderSoft: "#E3E6EA",
  // Primary text is the page navy itself, which is what keeps the two themes
  // reading as one product rather than two apps.
  text: { primary: "#13294A", secondary: "#3D5878", muted: "#5E7A99", dim: "#8AA0B8" },
  meaning: {
    attention: { ink: "#9A4708", fill: "#FDEBD3" },
    replied: { ink: "#116C34", fill: "#DCF5E4" },
    spoke: { ink: "#046A5A", fill: "#CBEDE4" },
    done: { ink: "#7A5B10", fill: "#F6EAC2" },
    progress: { ink: "#185E8C", fill: "#DBEAF7" },
    sequence: { ink: "#0B6076", fill: "#D2EFF7" },
    linkedin: { ink: "#BE185D", fill: "#FBDFEB" },
    longgame: { ink: "#6D28D9", fill: "#E9E1FB" },
    dormant: { ink: "#A34848", fill: "#F7E2E2" },
    error: { ink: "#B3261E", fill: "#FBE2E0" },
    idle: { ink: "#4E6B88", fill: "#E8EDF4" },
  },
  // Dark alphas, the mirror of the dark theme's white ones. Same precedence and
  // the same rule that the gaps stay wide enough to tell apart.
  row: {
    stripe: "rgba(19,41,74,0.030)",
    selected: "rgba(24,94,140,0.10)",
    hover: "rgba(19,41,74,0.065)",
    flash: "rgba(24,94,140,0.22)",
  },
  inkOnAccent: "#FFFFFF",
  primaryButton: { background: "#13294A", color: "#FFFFFF" },
  gradient: {
    hero:
      "radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.16), transparent 62%), " +
      "radial-gradient(120% 140% at 12% 0%, #1B3A63 0%, #13294A 55%, #0E1F38 100%)",
    warmAction: "linear-gradient(135deg, #B45309, #9A4708)",
  },
}

// Kept whole, not deleted. The light theme is the pilot, not a replacement, and
// both may end up offered.
export const DARK: Surface = {
  name: "dark",
  page: "#13294A",
  card: "#0F1F38",
  raised: "#16294a",
  well: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.12)",
  borderSoft: "rgba(255,255,255,0.08)",
  text: {
    primary: "rgba(255,255,255,0.92)",
    secondary: "rgba(255,255,255,0.75)",
    muted: "rgba(255,255,255,0.60)",
    dim: "rgba(255,255,255,0.35)",
  },
  meaning: {
    attention: { ink: "#FEB06A", fill: "rgba(254,176,106,0.08)" },
    replied: { ink: "#4ade80", fill: "rgba(74,222,128,0.16)" },
    spoke: { ink: "#a7f3d0", fill: "rgba(16,185,129,0.34)" },
    done: { ink: "#D4A444", fill: "rgba(212,164,68,0.22)" },
    progress: { ink: "#51ADE5", fill: "rgba(81,173,229,0.20)" },
    sequence: { ink: "#DCFEFF", fill: "rgba(220,254,255,0.10)" },
    linkedin: { ink: "#EC4899", fill: "rgba(236,72,153,0.10)" },
    longgame: { ink: "#c4b5fd", fill: "rgba(167,139,250,0.22)" },
    dormant: { ink: "rgba(255,150,150,0.78)", fill: "rgba(255,120,120,0.14)" },
    error: { ink: "rgba(255,120,120,0.95)", fill: "rgba(255,120,120,0.08)" },
    idle: { ink: "rgba(255,255,255,0.62)", fill: "rgba(255,255,255,0.10)" },
  },
  row: {
    stripe: "rgba(255,255,255,0.022)",
    selected: "rgba(81,173,229,0.06)",
    hover: "rgba(255,255,255,0.055)",
    flash: "rgba(81,173,229,0.28)",
  },
  inkOnAccent: "#04060F",
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

/** A status pill: ink on its own fill. The status SHAPE, per COLOR-SYSTEM §2. */
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
 * A phase-coloured initial tile. The sheen is a translucent white overlay rather
 * than a second hex per meaning, so any meaning can be tiled without adding
 * eleven more tokens to keep in sync.
 */
export function tile(s: Surface, key: MeaningKey): React.CSSProperties {
  return {
    background: `linear-gradient(135deg, rgba(255,255,255,0.24), rgba(255,255,255,0)), ${s.meaning[key].ink}`,
    color: s.name === "light" ? "#FFFFFF" : s.inkOnAccent,
  }
}

/** The flat, deliberately colourless tile for a contact nobody has worked yet. */
export function tileIdle(s: Surface): React.CSSProperties {
  return { background: s.meaning.idle.fill, color: s.meaning.idle.ink }
}
