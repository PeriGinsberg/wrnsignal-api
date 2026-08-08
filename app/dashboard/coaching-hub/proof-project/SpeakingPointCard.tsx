"use client"

// The reward. A deliverable's speaking point — the sentence the client can now
// say about themselves — revealed by a flip when the coach's sign-off lands.
//
// WHY A FLIP AND NOT A FADE. The card has a front ("locked") that is a real
// state the client sees for weeks, and a back that is the payoff. A fade would
// make the locked face look like a loading skeleton. A flip says the thing was
// always there and has now been turned over.
//
// THE LOCKED FACE NEVER CONTAINS THE TEXT. Not hidden, not zero-opacity — the
// server does not send it (see the route header). So "view source" is not a
// shortcut past the sign-off, which is what makes the unlock mean anything.
//
// Both faces occupy the SAME grid cell, so the card sizes itself to the taller
// of the two and a long speaking point cannot overflow a fixed height. This is
// the reason for the grid rather than the usual absolute-positioned faces.

import { useEffect, useState } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { ACCENT, ACCENT_EDGE, ACCENT_FAINT } from "./tokens"
import { useInViewOnce, useReducedMotion } from "./motion"

function LockIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function SpeakingPointCard({
  unlocked, text, whyThisMatters, deliverableName,
}: {
  unlocked: boolean
  /** Null whenever locked — the server withholds it. */
  text: string | null
  /** The coach's framing, gated identically to `text`. Often null: plenty of
   *  speaking points need no gloss, and an empty section under one would read
   *  as something failing to load. */
  whyThisMatters: string | null
  deliverableName: string
}) {
  const reduced = useReducedMotion()
  const [ref, inView] = useInViewOnce<HTMLDivElement>()
  const [flipped, setFlipped] = useState(false)

  // The unlock plays when the card is first SCROLLED TO, not on mount: the rail
  // sits below the fold on a phone, and an animation nobody saw may as well not
  // exist. A short beat after it lands so the flip is not already half over by
  // the time the eye arrives.
  // Under reduced motion the card is simply shown face-up (see showBack below),
  // so there is nothing to schedule and no state to write.
  useEffect(() => {
    if (!unlocked || !inView || flipped || reduced) return
    const t = setTimeout(() => setFlipped(true), 260)
    return () => clearTimeout(t)
  }, [unlocked, inView, flipped, reduced])

  const showBack = unlocked && (flipped || reduced)

  const face: React.CSSProperties = {
    gridArea: "1 / 1",
    borderRadius: 14,
    padding: "16px 18px",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 118,
    boxSizing: "border-box",
  }

  return (
    // position: relative so the flash ring and the screen-reader text below
    // anchor to this card rather than to whatever ancestor happens to be
    // positioned.
    <div ref={ref} style={{ position: "relative", perspective: 1200, marginTop: 14 }}>
      <div
        className="pp-animated"
        style={{
          display: "grid",
          transformStyle: "preserve-3d",
          transform: showBack ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 900ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        {/* ── Front: locked ── */}
        <div
          style={{
            ...face,
            background: "rgba(255,255,255,0.03)",
            border: `1px dashed ${T.BORDER}`,
            color: T.DIM,
            alignItems: "center",
            textAlign: "center",
            gap: 8,
          }}
          aria-hidden={showBack}
        >
          <span style={{ color: T.DIM, display: "inline-flex" }}><LockIcon size={18} /></span>
          <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: "18px", maxWidth: 230 }}>
            Your speaking point unlocks when your coach signs this off.
          </div>
        </div>

        {/* ── Back: the payoff ── */}
        <div
          style={{
            ...face,
            transform: "rotateY(180deg)",
            background: `linear-gradient(150deg, ${ACCENT_FAINT}, rgba(254,176,106,0.03))`,
            border: `1px solid ${ACCENT_EDGE}`,
            gap: 9,
          }}
          aria-hidden={!showBack}
        >
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.3, textTransform: "uppercase", color: ACCENT }}>
            You can now say:
          </div>
          {/* Quoted, in the client's own voice. The quotation marks are the
              reason the copy convention (first person) matters — third-person
              text here would read as a note about the client. */}
          <blockquote style={{ margin: 0, fontSize: 14.5, lineHeight: "21px", color: T.TEXT, fontWeight: 600 }}>
            {text ? `“${text}”` : null}
          </blockquote>

          {/* The coach's voice, and visibly not the client's: unquoted, lighter,
              behind a rule. The quote above is the thing to say out loud; this
              is why it lands. Two blocks of identical prose would blur which is
              which. */}
          {whyThisMatters && (
            <div style={{ marginTop: 4, paddingTop: 9, borderTop: `1px solid ${ACCENT_EDGE}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1.2, textTransform: "uppercase", color: T.DIM }}>
                Why this matters
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: "19px", color: T.MUTED }}>
                {whyThisMatters}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* The flash ring, purely decorative, drawn once as the flip completes. */}
      {showBack && !reduced && (
        <span
          aria-hidden
          className="pp-animated"
          style={{
            position: "absolute",
            width: 0, height: 0,
            animation: "pp-unlock-flash 900ms ease-out 1",
            pointerEvents: "none",
          }}
        />
      )}

      {/* The state, for a screen reader, without the theatre. */}
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {unlocked
          ? `${deliverableName} speaking point unlocked: ${text ?? ""}`
          : `${deliverableName} speaking point is locked until your coach signs it off.`}
      </span>
    </div>
  )
}
