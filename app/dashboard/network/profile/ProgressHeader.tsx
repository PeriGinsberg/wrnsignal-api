"use client"

// Progress as the focal point, not a footnote.
//
// The meter is at the top and large, because on a one-time setup screen the
// question the user actually has is "how much more of this is there" — and the
// answer has to be visible before the scrolling starts.
//
// The threshold signal is the substantive part. A single 0/17 bar makes stopping
// at a useful point look identical to giving up, so someone with the four
// must-haves filled has no way to know the tool already works for them.
//
// Redesign step 8 (2026-08-04): light theme. Copy and testids unchanged.

import { LIGHT as S, action as actionStyle, surfaceCard } from "../../../../lib/theme/surfaces"
import { StepCompleteIcon } from "../../../../components/icons"
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
    <div style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px", marginBottom: 18 }} data-testid="completeness">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{ color: S.text.primary, fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}
          data-testid="completeness-count"
        >
          {meter.filled} of {meter.total}
        </span>
        <span style={{ color: S.text.muted, fontSize: 14 }}>
          {complete
            ? "Complete — every template will have what it needs."
            : "filled. Templates leave a blank wherever one of these is empty."}
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            marginLeft: "auto", background: "none", border: "none", padding: 0,
            color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh from profile"}
        </button>
      </div>

      <div style={{ height: 9, borderRadius: 5, background: S.meaning.idle.fill, marginTop: 14, overflow: "hidden" }}>
        <div data-testid="progress-bar" style={{
          width: `${pct}%`, height: "100%",
          // Teal when done, the ATTENTION accent while in progress — not
          // `action.fill`. Both are peach, but the token says which story this
          // is: a measure of something outstanding, not a thing to press. Same
          // hue, and the rule stays intact because a status lookup can never
          // return the action token.
          background: complete ? S.meaning.replied.accent : S.meaning.attention.accent,
          transition: "width 220ms ease",
        }} />
      </div>

      {ready.ready ? (
        <div data-testid="send-ready" style={{
          marginTop: 14, display: "flex", alignItems: "center", gap: 8,
          color: S.meaning.replied.ink, fontSize: 14, fontWeight: 800,
        }}>
          <StepCompleteIcon size={16} />
          Enough to start sending{!complete && <span style={{ color: S.text.muted, fontWeight: 600 }}> — the rest sharpens the wording</span>}
        </div>
      ) : (
        <div data-testid="send-not-ready" style={{
          marginTop: 14, color: S.meaning.attention.ink, fontSize: 14, fontWeight: 800,
        }}>
          {ready.remaining} more to start sending
          <span style={{ color: S.text.muted, fontWeight: 600 }}>
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
