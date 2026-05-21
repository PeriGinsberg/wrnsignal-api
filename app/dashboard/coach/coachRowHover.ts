"use client"

// Canonical "clickable row hover" affordance for the Coaches Center.
// Used by every clickable row across:
//   - /dashboard/coach                       (My Clients top-5, Required
//                                             Actions top-5: both Action
//                                             Items + Engagement Signals)
//   - /dashboard/coach/clients               (My Clients full roster)
//   - /dashboard/coach/required-actions      (both Action Items +
//                                             Engagement Signals
//                                             sections)
//   - /dashboard/coach/applications-recent   (the 2.3 surface)
//
// Visual: subtle lighter-navy background on hover, pointer cursor,
// 120ms ease transition. No border change, no text color change, no
// scale/shadow.
//
// Design rationale: subtle bg-only hover is the universal dashboard
// row-hover pattern (Linear, Notion, GitHub). Avoids using brand
// colors on hover — Orange (tension), Teal (direction), Blue
// (authority/info) keep their semantic meanings everywhere else in
// the UI. The shift doesn't compete with status pills, lifecycle
// pills, or annotation badges that may render inside the row.
//
// Implementation: imperative style mutation rather than React state
// because most consumer rows live inside .map() — hooks can't be
// called there without a per-row component extraction. The mutation
// pattern is identical to what the prior CrossClientActionItemsList
// hover used (this commit also retargets that one to the canonical
// bg-only treatment).

import type { MouseEvent } from "react"

export const COACH_ROW_DEFAULT_BG = "rgba(255,255,255,0.025)"
export const COACH_ROW_HOVER_BG = "rgba(255,255,255,0.06)"
export const COACH_ROW_TRANSITION = "background 120ms ease"

export function onCoachRowEnter(e: MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = COACH_ROW_HOVER_BG
}

export function onCoachRowLeave(
  e: MouseEvent<HTMLElement>,
  defaultBg: string = COACH_ROW_DEFAULT_BG,
) {
  e.currentTarget.style.background = defaultBg
}
