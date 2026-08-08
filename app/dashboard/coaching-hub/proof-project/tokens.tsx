"use client"

// ONE VIVID ACCENT, and the discipline that makes it read as one.
//
// The page uses SIGNAL's existing warm accent and nothing else saturated. Every
// glow, fill, stamp and unlock is this hex at a different alpha, which is what
// makes the colour mean "progress" here rather than just "highlight".
//
// THE OWNER LEGEND IS THE ONE PLACE THAT WANTED A SECOND COLOUR and does not get
// one. The calendar has to distinguish three owners, and three saturated hues
// would leave the page with no accent at all — the fourth colour always steals
// the meaning of the first. So owners are distinguished by FORM, not hue: the
// client's own work is the solid accent (it is the thing the client acts on),
// shared work is the accent hollowed out, and the coach's own steps are a
// neutral dim dot. Legible in one glance, and the accent still means one thing.
//
// The success green is used in exactly two places — a completed node's check and
// the finished progress bar — because "done" is the one state that has to be
// distinguishable from "in progress" at a glance, and alpha alone cannot carry
// that. It is never used as a general accent.

import { T } from "../../../../lib/dashboard-theme"
import type { Owner } from "../../../../lib/proofProject"

export const ACCENT = T.WRN_ORANGE
export const ACCENT_DIM = "rgba(254,176,106,0.55)"
export const ACCENT_FAINT = "rgba(254,176,106,0.14)"
export const ACCENT_EDGE = "rgba(254,176,106,0.38)"
export const ACCENT_GLOW = "0 0 28px rgba(254,176,106,0.35)"

export type OwnerStyle = { label: string; dot: React.CSSProperties }

export const OWNER_STYLE: Record<Owner, OwnerStyle> = {
  client: {
    label: "You",
    dot: { background: ACCENT, border: `2px solid ${ACCENT}` },
  },
  both: {
    label: "Together",
    dot: { background: "transparent", border: `2px solid ${ACCENT}` },
  },
  coach: {
    label: "Your coach",
    dot: { background: "rgba(255,255,255,0.28)", border: "2px solid rgba(255,255,255,0.28)" },
  },
}

/** Fixed order, so the legend and every owner list read the same way twice. */
export const OWNER_ORDER: Owner[] = ["client", "both", "coach"]

export function OwnerDot({ owner, size = 9 }: { owner: Owner; size?: number }) {
  const s = OWNER_STYLE[owner]
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, flexShrink: 0,
        boxSizing: "border-box", display: "inline-block", ...s.dot,
      }}
    />
  )
}

/**
 * Every keyframe the page uses, mounted once by the page shell.
 *
 * They live in one <style> rather than per-component because a component that
 * renders N times would otherwise inject N identical rule sets. All of them
 * animate transform/opacity/filter only, and all are wrapped in a
 * prefers-reduced-motion guard: under that setting the elements simply sit in
 * their end state, which every rule below is written to be.
 */
export function ProofProjectKeyframes() {
  return (
    <style>{`
@keyframes pp-stamp {
  0%   { transform: scale(2.4) rotate(-18deg); opacity: 0; }
  60%  { transform: scale(0.86) rotate(4deg);  opacity: 1; }
  100% { transform: scale(1) rotate(0deg);     opacity: 1; }
}
@keyframes pp-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(254,176,106,0.55), 0 0 22px rgba(254,176,106,0.30); }
  50%      { box-shadow: 0 0 0 10px rgba(254,176,106,0), 0 0 30px rgba(254,176,106,0.45); }
}
@keyframes pp-rise {
  from { transform: translateY(14px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
@keyframes pp-unlock-flash {
  0%   { opacity: 0; transform: scale(0.6); }
  40%  { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0; transform: scale(1.9); }
}
@media (prefers-reduced-motion: reduce) {
  .pp-animated,
  .pp-animated * {
    animation: none !important;
    transition: none !important;
  }
}
    `}</style>
  )
}
