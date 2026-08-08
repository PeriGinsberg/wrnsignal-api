"use client"

// The whole plan, in full, behind disclosure triangles.
//
// WHY IT EXISTS AT ALL on a page built to avoid being a task list: the journey
// is a summary, and a summary that cannot be checked is not trustworthy. This is
// where a client goes to answer "yes, but what is actually IN deliverable 3".
// It is last on the page and collapsed by default, so it informs without
// competing with the journey for attention.
//
// THE CURRENT DELIVERABLE STARTS OPEN and every other starts closed. Opening all
// of them recreates the task list this page exists to replace; opening none
// makes the section look empty and inert.
//
// <details>/<summary> rather than a hand-rolled toggle: keyboard, screen reader
// and find-in-page behaviour come for free and are notoriously easy to get wrong
// by hand. Native disclosure cannot animate its own height, which is a fair
// trade for correctness on a read-only section — the page's motion lives above.

import { useState } from "react"
import { T } from "../../../../lib/dashboard-theme"
import { ACCENT } from "./tokens"
import { OwnerDot } from "./tokens"
import { nodeStates, progressOf, type ProofActivity, type ProofDeliverable } from "../../../../lib/proofProject"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function fmtDue(d: string | null): string {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ""
}

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
}

function TaskRow({ a }: { a: ProofActivity }) {
  const done = a.status === "complete"
  return (
    <li
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "7px 0",
        borderTop: `1px solid ${T.BORDER_SOFT}`,
        flexWrap: "wrap",
      }}
    >
      <span style={{ alignSelf: "center", display: "inline-flex" }}>
        <OwnerDot owner={a.owner} />
      </span>
      <span
        style={{
          flex: "1 1 180px",
          minWidth: 0,
          fontSize: 13.5,
          lineHeight: "19px",
          color: done ? T.MUTED : T.TEXT,
          // Struck through only when done — the one place this page shows a
          // completed task the way a task list would, because here it IS a list.
          textDecoration: done ? "line-through" : "none",
        }}
      >
        {a.name}
      </span>
      {a.due_date && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: T.DIM, fontVariantNumeric: "tabular-nums" }}>
          {fmtDue(a.due_date)}
        </span>
      )}
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: done ? T.SUCCESS : a.status === "in_progress" ? ACCENT : T.DIM,
          whiteSpace: "nowrap",
        }}
      >
        {STATUS_LABEL[a.status] ?? a.status}
      </span>
    </li>
  )
}

export function PlanTree({ deliverables }: { deliverables: ProofDeliverable[] }) {
  const states = nodeStates(deliverables)
  const currentIndex = states.indexOf("current")
  // Uncontrolled after first render: <details> owns its own open state, this
  // only seeds it.
  const [seeded] = useState(currentIndex)

  return (
    <section style={{ marginTop: 26 }}>
      <h2 style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: T.MUTED, margin: "0 0 12px" }}>
        The full plan
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {deliverables.map((d, i) => {
          const p = progressOf(d.activities)
          const state = states[i]
          return (
            <details
              key={d.id}
              open={i === seeded}
              style={{
                borderRadius: 12,
                background: T.CARD,
                border: `1px solid ${state === "current" ? "rgba(254,176,106,0.30)" : T.BORDER_SOFT}`,
                overflow: "hidden",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  listStyle: "none",
                  padding: "13px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 11.5, fontWeight: 900, color: state === "complete" ? T.SUCCESS : state === "current" ? ACCENT : T.DIM,
                    fontVariantNumeric: "tabular-nums", flexShrink: 0,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ flex: "1 1 160px", minWidth: 0, fontSize: 14.5, fontWeight: 800, color: T.TEXT, overflowWrap: "anywhere" }}>
                  {d.name}
                </span>

                {/* A miniature of the hero bar, so the row carries its own
                    progress without needing to be opened. */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                  <span style={{ width: 54, height: 5, borderRadius: 999, background: "rgba(255,255,255,0.09)", overflow: "hidden" }}>
                    <span
                      style={{
                        display: "block", height: "100%", borderRadius: 999,
                        width: `${p.percent}%`,
                        background: p.percent === 100 ? T.SUCCESS : ACCENT,
                      }}
                    />
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: T.DIM, fontVariantNumeric: "tabular-nums" }}>
                    {p.completed}/{p.total}
                  </span>
                </span>
              </summary>

              <ul style={{ listStyle: "none", margin: 0, padding: "0 16px 12px" }}>
                {d.activities.length === 0 ? (
                  <li style={{ padding: "8px 0", fontSize: 13, color: T.DIM, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
                    No tasks on this deliverable yet.
                  </li>
                ) : (
                  d.activities.map((a) => <TaskRow key={a.id} a={a} />)
                )}
              </ul>
            </details>
          )
        })}
      </div>
    </section>
  )
}
