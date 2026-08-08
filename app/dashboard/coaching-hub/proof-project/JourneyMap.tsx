"use client"

// The journey: deliverables as connected nodes, left to right.
//
// A HORIZONTAL RAIL, NOT A LIST, because the sequence is the message — this
// deliverable, then that one, then the thing you are working toward. A vertical
// list of the same rows says "here are six items" and loses the ordering that
// makes it a journey.
//
// It scrolls horizontally with scroll-snap rather than wrapping. Wrapping to a
// second row breaks the line: node 5 would sit under node 1 with a connector
// implying it comes next. Scrolling keeps one unbroken track at every width, and
// the current node is scrolled into view on load so a client six deliverables in
// does not land looking at week one.
//
// The connector is drawn on the LEFT of each node and coloured by the previous
// node's state, so the track lights up behind you as you go.

import { useEffect, useRef } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { ACCENT, ACCENT_FAINT } from "./tokens"
import { useInViewOnce, useReducedMotion } from "./motion"
import { SpeakingPointCard } from "./SpeakingPointCard"
import { nodeStates, progressOf, type NodeState, type ProofDeliverable } from "../../../../lib/proofProject"

function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4.5 4.5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const NODE = 62

function Node({ state, index, seen }: { state: NodeState; index: number; seen: boolean }) {
  const reduced = useReducedMotion()

  const base: React.CSSProperties = {
    width: NODE, height: NODE, borderRadius: 999,
    display: "grid", placeItems: "center",
    flexShrink: 0, boxSizing: "border-box",
    transition: "background 400ms ease, border-color 400ms ease",
  }

  if (state === "complete") {
    return (
      <div
        style={{
          ...base,
          background: "rgba(74,222,128,0.14)",
          border: `2px solid rgba(74,222,128,0.55)`,
          color: T.SUCCESS,
        }}
      >
        {/* The stamp: scales down and rotates into place, once, when the rail is
            first seen. Staggered by index so the row lands as a sequence rather
            than all at once. */}
        <span
          className="pp-animated"
          style={{
            display: "inline-flex",
            animation: seen && !reduced ? `pp-stamp 520ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 90}ms both` : "none",
          }}
        >
          <CheckIcon />
        </span>
      </div>
    )
  }

  if (state === "current") {
    return (
      <div
        className="pp-animated"
        style={{
          ...base,
          background: ACCENT_FAINT,
          border: `2px solid ${ACCENT}`,
          color: ACCENT,
          fontWeight: 900,
          fontSize: 20,
          // The only looping animation on the page, and it is on exactly one
          // element: the thing you are meant to be doing now.
          animation: reduced ? "none" : "pp-pulse 2.6s ease-in-out infinite",
        }}
      >
        {index + 1}
      </div>
    )
  }

  return (
    <div
      style={{
        ...base,
        background: "rgba(255,255,255,0.03)",
        border: `2px solid ${T.BORDER_SOFT}`,
        color: T.DIM,
      }}
    >
      <LockIcon />
    </div>
  )
}

export function JourneyMap({ deliverables }: { deliverables: ProofDeliverable[] }) {
  const [ref, seen] = useInViewOnce<HTMLDivElement>()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef<HTMLDivElement | null>(null)
  const states = nodeStates(deliverables)

  // Land on the work in progress, not on week one. scrollIntoView with
  // block:"nearest" so bringing a node into horizontal view never yanks the
  // whole PAGE down to the rail.
  useEffect(() => {
    const el = currentRef.current
    const scroller = scrollerRef.current
    if (!el || !scroller) return
    if (el.offsetLeft < scroller.clientWidth * 0.8) return // already visible
    el.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" })
  }, [])

  return (
    <section ref={ref} style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: T.MUTED, margin: "0 0 14px" }}>
        The journey
      </h2>

      <div
        ref={scrollerRef}
        style={{
          display: "flex",
          gap: 0,
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x proximity",
          // Room for the current node's glow, which would otherwise be clipped
          // by the scroll container.
          padding: "10px 2px 6px",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "thin",
        }}
      >
        {deliverables.map((d, i) => {
          const state = states[i]
          const p = progressOf(d.activities)
          const prevComplete = i > 0 && states[i - 1] === "complete"
          return (
            <div
              key={d.id}
              ref={state === "current" ? currentRef : undefined}
              style={{
                scrollSnapAlign: "center",
                flex: "0 0 auto",
                width: "min(76vw, 250px)",
                display: "flex",
                flexDirection: "column",
                opacity: state === "future" ? 0.55 : 1,
                transition: "opacity 400ms ease",
              }}
            >
              {/* Node + the connector coming into it. */}
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <div
                  aria-hidden
                  style={{
                    height: 3,
                    flex: 1,
                    borderRadius: 999,
                    // First node has no incoming track.
                    background: i === 0 ? "transparent" : prevComplete ? "rgba(74,222,128,0.45)" : T.BORDER_SOFT,
                    transition: "background 500ms ease",
                  }}
                />
                <Node state={state} index={i} seen={seen} />
                <div
                  aria-hidden
                  style={{
                    height: 3,
                    flex: 1,
                    borderRadius: 999,
                    background:
                      i === deliverables.length - 1
                        ? "transparent"
                        : state === "complete"
                          ? "rgba(74,222,128,0.45)"
                          : T.BORDER_SOFT,
                    transition: "background 500ms ease",
                  }}
                />
              </div>

              <div style={{ padding: "0 12px" }}>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 14.5,
                    fontWeight: 800,
                    lineHeight: "20px",
                    color: state === "future" ? T.MUTED : T.TEXT,
                    textAlign: "center",
                    overflowWrap: "anywhere",
                  }}
                >
                  {d.name}
                </div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 12,
                    fontWeight: 700,
                    color: state === "current" ? ACCENT : T.DIM,
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.total === 0 ? "No tasks" : `${p.completed}/${p.total} tasks`}
                </div>

                {/* Deliverables with no speaking point simply have no card — an
                    empty one would promise a reward that does not exist. */}
                {d.has_speaking_point && (
                  <SpeakingPointCard
                    unlocked={state === "complete"}
                    text={d.speaking_point}
                    deliverableName={d.name}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 6, fontSize: 12, color: T.DIM }}>
        Scroll sideways to see the whole journey.
      </div>
    </section>
  )
}
