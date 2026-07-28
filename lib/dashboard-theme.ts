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
  ERROR: "rgba(255,120,120,0.95)",
  SUCCESS: "#4ade80",
  SUCCESS_BG: "rgba(74,222,128,0.10)",
  WARNING_BG: "rgba(254,176,106,0.08)",
  ERROR_BG: "rgba(255,120,120,0.08)",

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
export const PHASE = {
  idle:     { fg: "rgba(255,255,255,0.62)", bg: "rgba(255,255,255,0.10)" }, // not started
  active:   { fg: "#51ADE5",                bg: "rgba(81,173,229,0.20)"  }, // in progress
  alive:    { fg: "#4ade80",                bg: "rgba(74,222,128,0.16)"  }, // replied
  momentum: { fg: "#a7f3d0",                bg: "rgba(16,185,129,0.34)"  }, // chat booked/done
  longgame: { fg: "#c4b5fd",                bg: "rgba(167,139,250,0.22)" }, // nurture / ask
  won:      { fg: "#FEB06A",                bg: "rgba(254,176,106,0.22)" }, // outcome
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
