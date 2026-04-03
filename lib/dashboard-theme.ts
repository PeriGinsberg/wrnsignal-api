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

  GRAD_PRIMARY: "linear-gradient(90deg, #FEB06A, #51ADE5)",
  GRAD_PROFILE: "linear-gradient(90deg, #51ADE5, #218C8C, #FEB06A)",
  GRAD_PERSONA: "linear-gradient(90deg, #FEB06A, #f97316, #51ADE5)",
} as const

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
