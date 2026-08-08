"use client"

// The hero: what this is, how far through it you are, and how long is left.
//
// THE PERCENTAGE IS THE HEADLINE and everything else is sized against it. It
// counts up on load because a number that arrives at 64 says "you got here",
// where a number that is simply 64 says "this is your score" — the same value,
// a different claim.
//
// The bar fills with transform: scaleX, not width. Width animation forces layout
// on every frame; scaleX is composited. transform-origin: left is what makes it
// read as filling rather than growing from the middle.

import { T } from "../../../../lib/dashboard-theme"
import { ACCENT, ACCENT_DIM, ACCENT_GLOW } from "./tokens"
import { useCountUp, useMountedFlag } from "./motion"
import { daysUntil, type Progress } from "../../../../lib/proofProject"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmtDate(d: string | null): string {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""
}

/**
 * The countdown copy. Four states, and each says something different — a single
 * "N days" string would call an overdue project "-3 days", which is both ugly
 * and easy to misread as three days remaining.
 */
function countdown(days: number | null): { value: string; label: string; urgent: boolean } | null {
  if (days === null) return null
  if (days > 1) return { value: String(days), label: "days to go", urgent: days <= 7 }
  if (days === 1) return { value: "1", label: "day to go", urgent: true }
  if (days === 0) return { value: "Today", label: "final deliverable due", urgent: true }
  const over = Math.abs(days)
  return { value: String(over), label: over === 1 ? "day past due" : "days past due", urgent: true }
}

export function Hero({
  name, progress, finalDate, now,
}: {
  name: string
  progress: Progress
  finalDate: string | null
  now: Date
}) {
  const percent = useCountUp(progress.percent)
  const mounted = useMountedFlag()
  const cd = countdown(daysUntil(finalDate, now))
  const done = progress.percent === 100

  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 20,
        padding: "clamp(22px, 5vw, 40px)",
        background: `radial-gradient(120% 140% at 0% 0%, rgba(254,176,106,0.16) 0%, rgba(254,176,106,0) 55%), ${T.CARD}`,
        border: `1px solid ${T.BORDER}`,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: ACCENT }}>
            Proof Project
          </div>
          <h1
            style={{
              margin: "8px 0 0",
              // Fluid, so a long package name does not wrap to four lines on a
              // phone or look lost on a desktop.
              fontSize: "clamp(24px, 4.4vw, 38px)",
              lineHeight: 1.15,
              fontWeight: 900,
              color: T.TEXT,
              overflowWrap: "anywhere",
            }}
          >
            {name}
          </h1>
        </div>

        {/* The number. tabular-nums stops the layout jittering as digits change
            during the count-up. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontSize: "clamp(46px, 11vw, 84px)",
              lineHeight: 0.9,
              fontWeight: 900,
              color: ACCENT,
              fontVariantNumeric: "tabular-nums",
              textShadow: ACCENT_GLOW,
            }}
          >
            {percent}
          </span>
          <span style={{ fontSize: "clamp(18px, 3vw, 28px)", fontWeight: 900, color: ACCENT_DIM }}>%</span>
        </div>
      </div>

      {/* ── The bar ── */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label={`${progress.completed} of ${progress.total} tasks complete`}
        style={{
          marginTop: 22,
          height: 10,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 999,
            background: done
              ? `linear-gradient(90deg, ${ACCENT}, ${T.SUCCESS})`
              : `linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT})`,
            // scaleX from 0 → the real fraction. The bar is full-width in layout
            // and squashed by transform, so no frame costs a reflow.
            transform: `scaleX(${mounted ? progress.percent / 100 : 0})`,
            transformOrigin: "left center",
            transition: "transform 1.4s cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: "10px 26px",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 14, color: T.MUTED, fontVariantNumeric: "tabular-nums" }}>
          <strong style={{ color: T.TEXT, fontWeight: 800 }}>{progress.completed}</strong>
          {" of "}
          <strong style={{ color: T.TEXT, fontWeight: 800 }}>{progress.total}</strong>
          {" tasks complete"}
        </div>

        {/* No dates set is a real and common state — the coach sets them per
            client where they matter. Showing nothing beats a countdown to
            nowhere. */}
        {cd && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
            <span
              style={{
                fontSize: "clamp(20px, 3.4vw, 28px)",
                fontWeight: 900,
                lineHeight: 1,
                color: cd.urgent ? ACCENT : T.TEXT,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {cd.value}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.MUTED, textTransform: "uppercase", letterSpacing: 0.8 }}>
              {cd.label}
            </span>
          </div>
        )}
      </div>

      {finalDate && (
        <div style={{ marginTop: 6, fontSize: 12.5, color: T.DIM }}>
          Final deliverable {fmtDate(finalDate)}
        </div>
      )}
    </section>
  )
}
