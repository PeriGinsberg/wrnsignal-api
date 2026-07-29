# Contact Record — UX Redesign

Add to `docs/network-tracker/` as `UX-CONTACT-RECORD.md`. This restructures an
already-built, already-tested screen. **Nothing is removed** — every current capability
stays reachable. The work is reorder, consolidate, and hide-until-needed.

## The problem being fixed

The current record stacks ten sections vertically — reminder, details, additional info,
pipeline bar, stage, message, action log, about-this-person, notes — all visible at once,
all the same navy. A first-time user with no coach can't tell where to look or what to do
first. The thing they came for (send a message / log that they reached out) is at the bottom.

## The principle

Show the one thing this screen is for, hide the rest until asked. The screen's job is
**"what's my next move with this person, and let me do it."** Everything else is reference
that folds away.

## New layout, top to bottom

### 1. Header (compact)
Name, title · company, and a small stage pill showing current stage (colored by the 7-group
phase palette — same colors as the spreadsheet and dashboard). One line. The email link stays,
smaller.

### 2. Your next move — the action box (the heart of the screen)
A single bordered card, accented with `--border-accent`, sitting directly under the header.
This is where the eye lands. It contains:

- Label "YOUR NEXT MOVE" and, top-right, the template selector showing the suggested template
  (`pickTemplate` result, e.g. "C2 · Send follow-up"). The dropdown lets the user pick a
  different template.
- The rendered message (from `renderTemplate`) in an editable box — this is the existing
  per-contact scratchpad from 8d, unchanged in behavior.
- Primary button **"Copy and mark as sent"** in the warm brand color (`--fill-brand` /
  `--on-brand`) — the one loud element on the screen. Secondary "Copy only" beside it, quiet.
- If `pickTemplate` returns null (no relationship set, or an S1/S5 case), the box shows
  "Pick a template to get started" with the selector, instead of a suggested message — the
  existing fallback.
- Fill-at-send and unresolved-variable warnings stay exactly as built.

This box merges what used to be three things — the pipeline bar, the stage dropdown, and the
Send panel — into one. Sending a message advances the stage automatically (it already does).

### 3. Something happened — quick stage actions
A single row of plain-language buttons for the moves a user makes WITHOUT sending a message.
These replace the raw stage dropdown on this screen. Each sets the appropriate stage:

- **They replied** → `replied`
- **We talked** → `chat_done`
- **They said no** → `dormant_declined`
- **Got the outcome** → `outcome`

Keep the set small — these four cover the common no-message transitions. (The full 11-stage
control still lives on the spreadsheet view for precise/backward edits; it is intentionally
NOT duplicated here.) A contact can still reach any stage; this is just the fast path for the
frequent ones.

### 4. Reminder line (compact)
One line: "No reminder set" or the current reminder, with Snooze 3d/7d/14d as small buttons
and a Clear when one is set. This is the existing reminder control, condensed from a full
banner to a single row.

### 5. Collapsed sections — Details, History, Notes
Three expandable rows, collapsed by default, each showing a one-line summary so the user knows
what's inside without opening:

- **Details** — relationship, priority, segment (the current DETAILS block + the merged
  ADDITIONAL INFO field). Summary line shows the set values or "not set."
- **History** — the dated action log (currently "ACTION LOG") plus the add-action form.
  Summary: "N touches logged" or "nothing yet." **Auto-expand when there is ≥1 action.**
- **Notes** — the running note log (currently "NOTES") plus "About this person" as a pinned
  field at its top. Summary: "N notes" or "nothing yet." **Auto-expand when there is ≥1 note.**

This collapses the four redundant text areas (Details, Additional info, About this person,
Notes) into two clearly-named drawers. "Additional info" folds into Details; "About this
person" becomes the pinned summary atop Notes.

## Color treatment

Break the all-navy wall with three registers, meaning-carrying, not decorative:

- **Warm (brand) = act here.** Only the primary "Copy and mark as sent" button. One warm
  element per screen.
- **Phase colors = status.** The header stage pill uses the 7-group phase palette. Reuse the
  existing `STAGE_PHASE` colors — do not invent new ones.
- **Quiet = reference.** Collapsed section rows, the reminder line, secondary buttons all
  recede — muted text, hairline borders, no fill. They step back so the action box steps
  forward.

The action box gets the accent border so it reads as the primary surface. Everything below it
is visually quieter.

## What must NOT change

- The 8d copy-and-mark-as-sent behavior (copy first, log only on success, action from
  `next_due_reason`).
- The per-contact scratchpad (ephemeral edits, discard on switch).
- The reminder engine, the stage transitions, the note-vs-touch distinction.
- Any route or data shape. This is a presentation restructure only — no migration.

## Build approach

This is a rewrite of an existing screen with test coverage. Before rewriting:
1. Propose the new component structure — which existing components move, merge, or get
   wrapped in a collapsible — and show me before building.
2. Keep every existing test passing where the capability is unchanged; where a control moved
   (e.g. stage now via quick-actions + template selector rather than a standalone dropdown),
   update the test to exercise the new control, and confirm the underlying action still fires.
3. Component-test the new shape: the action box renders the suggested template, the quick-action
   buttons set the right stage, and the collapsed sections expand/collapse and auto-expand when
   they have content.

---

# BUILT — and where it diverged

Shipped as one unit. Components: `ActionBox`, `QuickActions`, `ChangeStage`, `Collapsible`;
`PipelineStepper.tsx` retired. Tests: `ContactRecord.test.tsx` (18), `ChangeStage.test.tsx` (9),
plus `stageAfterAction` cases in `action-semantics.test.ts`.

**§2's premise was wrong, and fixing it was the priority.** The doc said "sending a message
advances the stage automatically (it already does)". It did not. The reminder engine makes
exactly ONE stage write in its entire switch — `sequence_active → dormant_no_answer` after two
follow-up touches — and nothing moved `identified → sequence_active`. Worse, `identified` has no
due reason (`pokeEnabled` is hardcoded `false`), so `SendPanel` had no action to log and rendered
no primary button at all: the screen built around sending could not send a first message.

Fixed with `stageAfterAction(stage, type)` in `action-semantics.ts` — the single case where the
record LEADS the engine rather than following it. Applied in the actions route BEFORE
`computeNextDue` runs, so the engine schedules touch 2 from the stage the contact is moving to.
One action, one request, no manual stage move.

**Quick actions split by likelihood** rather than the flat four. "They replied" and "We talked"
are prominent; "They said no" and "Got the outcome" are terminal and rare, so they sit behind
`Change stage` — which, per a later decision, reaches ALL ELEVEN stages, not just the leftovers.
It is the only place on the record that does, and it carries the two behaviours that would
otherwise have died with `PipelineStepper`: the outcome-type sub-attribute, and the "requesting
an intro usually means Referred" suggestion.

**Details auto-expands on unset RELATIONSHIP specifically**, not on emptiness generally —
`pickTemplate` routes on that one field, so an unset relationship is why the action box above has
no suggestion, and the closed summary says so.

**Coach comments was cut, not folded.** It was an unwired placeholder with no capability behind
it; Phase 10 builds the real thing.

**Known gap:** the route wiring (that `effectiveStage` is what reaches `computeNextDue`) is
verified by reading, not by a test. The rule itself is unit-tested and the client half is
component-tested; there is no route-test harness in this repo.
