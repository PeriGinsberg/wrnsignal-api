"use client"

// Progress as the focal point, not a footnote.
//
// The meter moved to the top and grew, because on a one-time setup screen the
// question the user actually has is "how much more of this is there" — and the
// answer has to be visible before the scrolling starts.
//
// The threshold signal is the substantive part. A single 0/17 bar makes stopping
// at a useful point look identical to giving up, so someone with the four
// must-haves filled has no way to know the tool already works for them.

import { T, card, btnSecondary } from "../../../../lib/dashboard-theme"
import { sendReadiness } from "./fieldState"

type Completeness = { filled: number; total: number; missing: string[] }

export function ProgressHeader({
  meter, profile, refreshing, onRefresh,
}: {
  meter: Completeness
  profile: Record<string, unknown> | null
  refreshing: boolean
  onRefresh: () => void
}) {
  const ready = sendReadiness(profile)
  const pct = meter.total ? Math.round((meter.filled / meter.total) * 100) : 0
  const complete = meter.filled === meter.total

  return (
    <div style={{ ...card, padding: "16px 18px", marginBottom: 16 }} data-testid="completeness">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: T.TEXT, fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }} data-testid="completeness-count">
          {meter.filled} of {meter.total}
        </span>
        <span style={{ color: T.MUTED, fontSize: 12.5 }}>
          {complete
            ? "Complete — every template will have what it needs."
            : "filled. Templates leave a blank wherever one of these is empty."}
        </span>
        <button onClick={onRefresh} disabled={refreshing}
          style={{ ...btnSecondary, marginLeft: "auto", padding: "7px 12px", fontSize: 12 }}>
          {refreshing ? "Refreshing…" : "Refresh from profile"}
        </button>
      </div>

      <div style={{ height: 8, borderRadius: 4, background: T.BORDER_SOFT, marginTop: 12, overflow: "hidden" }}>
        <div data-testid="progress-bar" style={{
          width: `${pct}%`, height: "100%",
          background: complete ? T.SUCCESS : T.GRAD_PRIMARY,
          transition: "width 220ms ease",
        }} />
      </div>

      {ready.ready ? (
        <div data-testid="send-ready" style={{
          marginTop: 12, display: "flex", alignItems: "center", gap: 7,
          color: T.SUCCESS, fontSize: 12.5, fontWeight: 800,
        }}>
          <span aria-hidden>✓</span>
          Enough to start sending{!complete && <span style={{ color: T.MUTED, fontWeight: 600 }}> — the rest sharpens the wording</span>}
        </div>
      ) : (
        <div data-testid="send-not-ready" style={{
          marginTop: 12, color: T.WRN_ORANGE, fontSize: 12.5, fontWeight: 800,
        }}>
          {ready.remaining} more to start sending
          <span style={{ color: T.MUTED, fontWeight: 600 }}>
            {" — "}{ready.missing.map((k) => MUST_HAVE_LABEL[k] ?? k).join(", ")}
          </span>
        </div>
      )}
    </div>
  )
}

// Named for the person filling the form, not for the column.
const MUST_HAVE_LABEL: Record<string, string> = {
  client_first: "first name",
  target_role: "target role",
  target_field: "target field",
  elevator_pitch: "elevator pitch",
}
