// lib/dashboard-theme.ts
export const T = {
  BG: "#13294A",
  NAV_BG: "#091629",
  CARD: "#0F1F38",
  GLASS: "rgba(255,255,255,0.07)",
  BORDER: "rgba(255,255,255,0.12)",
  BORDER_SOFT: "rgba(255,255,255,0.08)",
  TEXT: "rgba(255,255,255,0.92)",
  MUTED: "rgba(255,255,255,0.60)",
  DIM: "rgba(255,255,255,0.35)",
  WRN_ORANGE: "#FEB06A",
  WRN_BLUE: "#51ADE5",
  WRN_TEAL: "#218C8C",
  // SIGNAL's pink, the same value the marketing palette calls `pink` — that
  // palette's orange/blue/green are byte-identical to WRN_ORANGE/WRN_BLUE/
  // SUCCESS below, so this is one system and the hex belongs here rather than
  // being retyped wherever a fourth accent is wanted.
  WRN_PINK: "#EC4899",
  // "Achieved", distinct from the action-warm above. Attention and done cannot
  // share a hex — see docs/network-tracker/COLOR-SYSTEM.md. This is the gold the
  // product already uses (JobFit's Review pill), reused rather than inventing a
  // second one; the two never appear on the same screen.
  GOLD: "#D4A444",
  GOLD_BG: "rgba(212,164,68,0.22)",
  ERROR: "rgba(255,120,120,0.95)",
  SUCCESS: "#4ade80",
  SUCCESS_BG: "rgba(74,222,128,0.10)",
  WARNING_BG: "rgba(254,176,106,0.08)",
  ERROR_BG: "rgba(255,120,120,0.08)",

  // Near-black ink for text sitting ON a bright accent fill, where TEXT (a
  // white at 92%) would vanish. The value was already the de-facto convention
  // in btnPrimary and ~30 call sites; naming it is what stops the next one
  // being typed from memory.
  INK_ON_ACCENT: "#04060F",
  /** Ink for text on a filled ERROR surface, where INK_ON_ACCENT reads too blue. */
  INK_ON_ERROR: "#1a0505",

  // Accent borders at a common strength, so a tinted edge reads the same
  // weight whichever accent it is drawn in. The two stronger warm steps exist
  // because the profile deliberately escalates: a soft edge invites, a stronger
  // one on the featured field says "this is the one that matters".
  ORANGE_BORDER: "rgba(254,176,106,0.35)",
  ORANGE_BORDER_MED: "rgba(254,176,106,0.45)",
  ORANGE_BORDER_STRONG: "rgba(254,176,106,0.55)",
  /** The faint halo under an attention surface — a glow, not an edge. */
  ORANGE_GLOW: "rgba(254,176,106,0.05)",
  SUCCESS_BORDER: "rgba(74,222,128,0.35)",
  PINK_BORDER: "rgba(236,72,153,0.35)",
  PINK_BG: "rgba(236,72,153,0.10)",
  // Blue tints, previously written as literals at four strengths in ChangeStage.
  BLUE_BG: "rgba(81,173,229,0.10)",
  BLUE_BG_ON: "rgba(81,173,229,0.15)",
  BLUE_BORDER: "rgba(81,173,229,0.35)",
  BLUE_BORDER_ON: "rgba(81,173,229,0.40)",

  NAV_ACTIVE_BG: "rgba(254,176,106,0.08)",
  NAV_ACTIVE_BORDER: "rgba(254,176,106,0.35)",
  NAV_DEFAULT_BG: "rgba(255,255,255,0.04)",

  // Table row states, deliberately ordered by strength so they stack rather
  // than compete. ROW_STRIPE is the base layer (zebra shading); the other three
  // are translucent OVERLAYS composited on top of it, so each reads the same on
  // a striped and an unstriped row. Keep the gaps between these values wide —
  // if the stripe creeps up toward the hover value the two stop being
  // distinguishable, which is the whole point of having both.
  ROW_STRIPE: "rgba(255,255,255,0.022)",   // barely-there lightening of the navy
  ROW_SELECTED: "rgba(81,173,229,0.06)",   // persistent, must stay quieter than hover
  ROW_HOVER: "rgba(255,255,255,0.055)",    // transient, follows the pointer
  ROW_FLASH: "rgba(81,173,229,0.28)",      // just-changed; loudest, wins over all

  GRAD_PRIMARY: "linear-gradient(90deg, #FEB06A, #51ADE5)",
  GRAD_PROFILE: "linear-gradient(90deg, #51ADE5, #218C8C, #FEB06A)",
  GRAD_PERSONA: "linear-gradient(90deg, #FEB06A, #f97316, #51ADE5)",
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
// responded", `momentum` is "we actually spoke" — a two-step progression within
// the same good news, which is why they are adjacent in hue as well as in the
// funnel. Collapsing them would lose the step that matters most to a user.
export const PHASE = {
  idle:     { fg: "rgba(255,255,255,0.62)", bg: "rgba(255,255,255,0.10)" }, // not started
  active:   { fg: T.WRN_BLUE,               bg: "rgba(81,173,229,0.20)"  }, // in progress
  alive:    { fg: T.SUCCESS,                bg: "rgba(74,222,128,0.16)"  }, // replied
  momentum: { fg: "#a7f3d0",                bg: "rgba(16,185,129,0.34)"  }, // chat booked/done
  longgame: { fg: "#c4b5fd",                bg: "rgba(167,139,250,0.22)" }, // nurture / ask
  won:      { fg: T.GOLD,                   bg: T.GOLD_BG               }, // outcome — ACHIEVED, not urgent
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
  fontSize: 13,
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

// Small caption above a control, naming the FIELD so the control's value is not
// mistaken for the field name. Shared so every labelled control looks identical.
// Pair with FIELD_LABELS for the text.
export const fieldLabel: React.CSSProperties = {
  color: T.MUTED,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.3,
  whiteSpace: "nowrap",
}
export const fieldWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
}

export const btnPrimary: React.CSSProperties = {
  background: T.GRAD_PRIMARY,
  color: "#04060F",
  fontWeight: 900,
  borderRadius: 13,
  padding: "13px 18px",
  fontSize: 13,
  border: "none",
  cursor: "pointer",
}

export const btnSecondary: React.CSSProperties = {
  background: T.NAV_DEFAULT_BG,
  border: `1px solid ${T.BORDER_SOFT}`,
  color: T.TEXT,
  fontWeight: 900,
  borderRadius: 13,
  padding: "13px 18px",
  fontSize: 13,
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
  fontSize: 26,
  fontWeight: 950,
  letterSpacing: -0.5,
  color: T.TEXT,
}

export const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 0.5,
}
