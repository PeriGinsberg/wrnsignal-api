"use client"

// The status of one plan activity, and the way to move it.
//
// WHAT THIS REPLACES. Three joined buttons — Not started | In progress |
// Complete — the client pressed to set status directly. That is status rendered
// AS buttons, which the light design language rules out: status is a coloured
// dot plus text, never a button, and peach is action and only action. The old
// control also coloured "In progress" peach, so the loudest thing on a plan row
// was a state rather than something to do.
//
// THE SHAPE NOW. Status appears once, as dot and text. Beside it sit the moves
// available from where the activity actually is:
//
//   Not started   ● Not started   Start   [ Mark complete ]
//   In progress   ● In progress           [ Mark complete ]
//   Complete      ● Complete      Reopen
//
// Peach is always the forward move and always the rightmost thing, so its
// position does not shuffle as an activity progresses. The quiet text buttons
// are the less common moves — starting something you have not started, and
// reopening something you finished — available without being advertised.
//
// EVERY VALUE THE OLD CONTROL COULD SET IS STILL SETTABLE. An earlier draft of
// this dropped `in_progress` from the client side on the grounds that nobody
// needs to declare a start before finishing. That was a functional loss dressed
// as a design simplification on a UI-only job, and it was reverted: "Start"
// writes `in_progress` exactly as the middle segment of the old three-button
// control did.

import { LIGHT as S, status as statusStyle, action as actionStyle } from "../../../lib/theme/surfaces"

/** Database value → the words and the meaning the row shows. */
const STATUS_META: Record<string, { label: string; meaning: "idle" | "attention" | "replied" }> = {
  not_started: { label: "Not started", meaning: "idle" },
  in_progress: { label: "In progress", meaning: "attention" },
  // Teal, not gold. Gold is `done` and belongs to an offer; finishing a plan
  // item is positive, not a win.
  complete: { label: "Complete", meaning: "replied" },
}

export function ActivityStatus({
  value,
  busy,
  onSet,
}: {
  value: string
  busy: boolean
  onSet: (status: string) => void
}) {
  // Normalise ONCE, so the buttons follow the status the row actually shows. An
  // unrecognised value displays as Not started, and therefore offers Start.
  const shown = STATUS_META[value] ? value : "not_started"
  const meta = STATUS_META[shown]
  const st = statusStyle(S, meta.meaning)
  const done = shown === "complete"

  return (
    <span
      style={{
        marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12,
        flexShrink: 0, opacity: busy ? 0.6 : 1,
      }}
    >
      <span data-testid="activity-status" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={st.dot} />
        <span style={{ ...st.text, fontSize: 14 }}>{meta.label}</span>
      </span>

      {/* Quiet, and before the peach one so peach stays rightmost in every
          state. Only offered from Not started: "start" is meaningless on
          something already in progress or finished. */}
      {shown === "not_started" && (
        <button
          type="button"
          data-testid="activity-start"
          disabled={busy}
          onClick={() => onSet("in_progress")}
          style={{
            background: "none", border: "none", padding: 0,
            color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          Start
        </button>
      )}

      {done ? (
        <button
          type="button"
          data-testid="activity-reopen"
          disabled={busy}
          onClick={() => onSet("not_started")}
          style={{
            background: "none", border: "none", padding: 0,
            color: S.action.quietInk, fontSize: 13.5, fontWeight: 700,
            cursor: busy ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          {busy ? "Saving…" : "Reopen"}
        </button>
      ) : (
        <button
          type="button"
          data-testid="activity-complete"
          disabled={busy}
          onClick={() => onSet("complete")}
          style={{
            ...actionStyle(S, "primary"),
            padding: "8px 14px", borderRadius: 10, fontSize: 13.5,
            fontFamily: "inherit", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap",
          }}
        >
          {busy ? "Saving…" : "Mark complete"}
        </button>
      )}
    </span>
  )
}
