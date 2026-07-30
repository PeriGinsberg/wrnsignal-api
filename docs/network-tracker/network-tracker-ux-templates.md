# Templates Screen — UX Redesign

Add to `docs/network-tracker/` as `UX-TEMPLATES.md`. The template editor (8e) is already
built — storage, GET/PATCH/DELETE routes, the renderer, the palette, live preview, revert,
dropped-variable warning all work. This redesigns how the user *navigates and edits* them.
No route or data change; the letter codes (A1, C2, S1…) remain the internal IDs and are
unchanged in storage. **They just never appear on screen.**

## The problem being fixed

The current screen (a 24-item left rail of letter codes: IN, P1–P3, A1–A3, C1–C3, X1–X3,
S1–S5, L1–L3) makes the user read a codebook to find a message. The codes are internal
shorthand leaking to the user. A person thinks "someone I have something in common with,
second message," not "A2."

## The principle

Pick who you're messaging in plain language → see that relationship's whole sequence as
cards → click a card to edit it in place. No codes, no 24-item wall, no second dropdown.

## The flow

### 1. Who are you messaging?
A row of five plain-language buttons (the relationship labels, from `RELATIONSHIP_LABELS`):
**Personal · Something in Common · Referral · Cold · Recruiter.** One is selected at a time,
selected one in the warm/accent state.

### 2. That relationship's sequence appears as cards
Selecting a relationship shows its three sequence messages as stacked cards, in order:

- **First outreach** · day 0  (the family's touch-1 template — P1/A1/R1/C1/X1)
- **Follow-up** · day 7  (touch 2)
- **Last follow-up** · day 12  (touch 3)

Each card shows: a sequence number (1/2/3 in a small circle), the plain name, the day, a
**default / "edited by you"** marker (accent when customized), and a preview of the body.

Plain names replace codes everywhere the user sees them. The mapping (display only):
- touch 1 → "First outreach"
- touch 2 → "Follow-up"
- touch 3 → "Last follow-up" (named to signal it's the end of the sequence — the contact goes
  dormant after this)

### 3. Reply messages — their own group
Below the sequence, a separate group framed "you write these once, they work for anyone,"
since they aren't tied to a relationship. Plain-language buttons:

- **Thank-you** (S2) · **Check-in** (S3) · **Ask for referral** (S4) · **Intro request** (IN)

(S1 scheduling and S5 post-referral thanks: decide whether to surface them here as
"Scheduling" and "Referral thank-you," or leave them out of the picker since they're rarely
edited. Recommend surfacing all of them here — this is the library, where completeness is fine,
unlike the contact record where auto-suggest deliberately omits S1/S5.)

The L family (LinkedIn) — if those templates exist in defaults, give them their own small
group ("LinkedIn"); if the L bodies were never finalized, omit the group.

### 4. Edit in place
Clicking a card expands it into the editor, inline, keeping the user in the sequence context.
The editor is the existing 8e editor — its internals are preserved:
- editable body with the variable palette (grouped "from your profile" / "from the contact" /
  "fill in when you send")
- live preview against the real profile and the fixed sample contact
- dropped-variable warning (non-blocking)
- Save (PATCH), Revert to default (DELETE)

**The one change to 8e:** its layout goes from three-column (list · editor · preview) to
**stacked inside the expanded card** — body, then palette as a chip row, then preview below.
The list rail is gone (replaced by the who-picker + cards); the editor and preview stack
vertically to fit the card width. All editor behavior is identical; only the arrangement
changes.

Collapsing the card (or opening another) returns to the sequence view. Same discard-on-switch
rule as before for unsaved edits.

## Copy

Replace the current dense explainer ("Edit any of these and your version is used from then on.
Changes here apply to every future message of that kind — to change one message for one person,
edit it in the Send panel on their record instead") with a short line under the sequence:

> "Three messages, spaced out. Edit any of them and your version is used from then on."

The "to change one message for one person" nuance can live as a small hint on the editor
itself, not a paragraph at the top.

## Color

- **Accent/warm** = the selected relationship button, and the "edited by you" marker.
- **Quiet** = "default" markers, day labels, unselected buttons.
- Cards are the standard surface; the expanded/editing card can take the accent border to show
  it's active.

No codes on screen in any state — that's the headline of this redesign.

## What must NOT change

- Template storage, IDs (A1/C2/S1…), the GET/PATCH/DELETE routes, the renderer, the join
  (`pickTemplate`), the per-contact scratchpad on the record. All unchanged.
- The contact record's Send panel — the tracker still auto-picks the template there; this
  redesign is only the Templates *library* screen.

## Build approach

1. Propose the component structure — the who-picker, the sequence-card list, and how the 8e
   editor gets re-laid-out from three-column to stacked-in-card — before building.
2. Reuse the 8e editor's logic wholesale; only its layout changes. Keep its tests passing where
   behavior is unchanged; update the ones that assumed the three-column DOM.
3. Component-test: picking a relationship shows its three sequence cards with plain names (assert
   no letter code appears in the rendered output), a card expands to the editor, and save/revert
   still work through the new layout.
