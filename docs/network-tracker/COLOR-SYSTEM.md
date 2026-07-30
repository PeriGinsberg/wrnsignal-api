# Networking colour system

The meaning→colour map for the networking function. **These rules are definitive.**
A colour is chosen by looking up the meaning here, never by picking something that
looks right — that is how the collisions in the appendix happened.

Audit taken 2026-07-30 at `2d1a3ef8`; rules locked and applied the same day.

---

## 1. Meaning → colour

| Meaning | Colour | Token |
|---|---|---|
| **Attention · act here · overdue** | warm orange `#FEB06A` | `T.WRN_ORANGE` |
| **Responded / alive** | green `#4ade80` | `T.SUCCESS` (= `PHASE.alive.fg`) |
| **We actually spoke** | mint `#a7f3d0` | `PHASE.momentum.fg` |
| **Achieved / outcome** | gold `#D4A444` | `T.GOLD` (= `PHASE.won.fg`) |
| **In progress** | blue `#51ADE5` | `T.WRN_BLUE` (= `PHASE.active.fg`) |
| **Long game (nurture/ask)** | violet `#c4b5fd` | `PHASE.longgame.fg` |
| **Dormant / resting** | salmon | `PHASE.resting.fg` |
| **Not started** | white 62% | `PHASE.idle.fg` |
| **Error · destructive** | red | `T.ERROR` |
| **Neutral confirmation** | muted white | `T.MUTED` |

### Warm owns attention, and only attention
Warm is the send button, overdue dates, required-empty fields, the late-worklist row,
the fill-at-send bracket. It is **not** "done". `PHASE.won` moved off `#FEB06A` to
`T.GOLD` — a deeper gold that reads accomplished rather than urgent — because attention
and done are close to opposites and cannot share a hex.

### Green means "they responded", not "it worked"
`T.SUCCESS` and `PHASE.alive.fg` are now **one token**, not two hexes that happened to
agree. Save-confirmations moved OFF green to `T.MUTED`: a save succeeding is not news
about a contact. The Templates "Replies" group keeps green — those genuinely are the
reply messages.

### The two greens are deliberate
`alive #4ade80` ("they responded") and `momentum #a7f3d0` ("we actually spoke") are a
**two-step progression inside the same good news**, which is why they are adjacent in hue
as well as in the funnel. This is a designed step, not a duplication. Do not collapse them.

---

## 2. The shape rule — what prevents the next overload

**Status = filled pill. Group identity = 3px left rail.**

A colour may carry both a status and a group meaning **because the shape disambiguates**:

- A **filled pill** always answers *what state is this contact in?* (`pillStyle()`)
- A **3px left rail + coloured section header** always answers *what family is this?*

Green in a pill means the contact replied. Green on a rail means the Replies section.
No reader confuses them, and no future screen has to invent a third convention. Any new
use of colour must pick one of these two shapes, or state why it is neither.

### Not every group needs a colour
The **primary content of a screen takes no rail**. On Templates the sequence is the
content and the two library groups are asides; colouring only the asides is what says so.
Three coloured peers would have made them compete, and it would have spent warm — which
inside those very cards has to mean "you write this" — on a section heading. A group with
no colour keeps the same 14px inset via a transparent rail, so headings stay aligned.

---

## 3. Brackets — the rule inside a message body

Applied in the Templates editor and its live preview (`brackets.tsx`).

| Bracket | Meaning | Colour |
|---|---|---|
| `[NAME]`, `[FIRM]`, `[CITY]`, `[CURRENT_ROLE]` … | fills itself in | calm `T.MUTED` |
| `_____` (profile blank, not yet filled) | fills itself in, once you complete your profile | calm `T.MUTED` |
| `[MUTUAL]`, `[OPTION 1]`, `[ONE SPECIFIC QUESTION]` … | **you write this** | warm `T.WRN_ORANGE`, bold |

This is the same warm = *your action* rule as overdue and required-empty: a blank you have
to fill is the part of the message that needs you. The split is not re-derived —
`classifyVariable()` in the 8b renderer stays the only authority on which bracket is which.

Implementation note: colouring inside an editable body needs a highlight layer behind a
transparent textarea. Both read one shared `BODY_BOX` style object; if they ever drift,
text slides off its own highlight.

**The "Insert field ▾" menu carries the same two colours** — its "You fill this in" section
renders warm, "About you" and "About them" calm — so the menu teaches the split rather than
just listing it. Its grouping comes from `classifyVariable()` too, which is why the menu and
the body cannot disagree about what a variable is.

---

## 4. Applied where

| Surface | State |
|---|---|
| Theme tokens | ✅ done |
| Phase palette (`alive` merged, `won` → gold) | ✅ done |
| Save-confirmations → neutral | ✅ done (7 sites) |
| Templates: Replies green, LinkedIn pink | ✅ done |
| Templates: bracket two-colour | ✅ done |
| Token hygiene (literals → tokens) | ✅ done |
| Templates: sequence section → neutral | ✅ done |
| Contacts spreadsheet | ⏳ not yet applied |
| Dashboard / funnel | ⏳ not yet applied (inherits the gold change) |
| Profile | ⏳ not yet applied |

---

## 5. Known, accepted overlaps

- **Blue means link, in-progress, and unsaved-edit.** Three meanings, but they never
  co-occur in a way that misleads: a link is underlined text, in-progress is a pill, an
  unsaved edit is a border. Left as-is deliberately. Revisit only if it bites.
- **`T.GOLD` is also JobFit's "Review" decision colour** (`app/dashboard/page.tsx:114`).
  Different function, never on the same screen as a networking phase pill. Accepted; flagged
  for the eventual product-wide pass.
- **Profile completion still uses green** (filled-field ✓, progress bar, section counts).
  By §1 that is arguably "it worked", not "they responded". Deliberately left for the
  profile screen's own pass rather than changed in passing.
- **The coach surfaces carry a fourth pink** (`#F4ADC9`, avatar palette). Out of scope.

---

## Appendix — the original audit, and what it found

The state before these rules, kept because it is the evidence for them.

**Fixed by this pass:**
- `T.SUCCESS` and `PHASE.alive.fg` were the same hex declared twice, ~55 lines apart —
  agreeing by coincidence. Now one token.
- `T.WRN_ORANGE` was exactly `PHASE.won.fg`, so warm meant attention *and* done.
- Green carried three meanings; the most frequent (save confirmation) was unrelated to the
  other two.
- Three warm border strengths (`0.35` token, `0.45`/`0.55` literals in `Field.tsx`), plus
  strays at `0.38` and `0.30` — now `ORANGE_BORDER` / `_MED` / `_STRONG`, with the two
  strays snapped to the nearest step (a ≤0.05 alpha change, invisible).
- `rgba(74,222,128,0.3)` near-missing `SUCCESS_BORDER` `0.35`.
- Untokenised blues at `0.10/0.12/0.15/0.35/0.40` in `ChangeStage` and `WorklistRow` —
  now `BLUE_BG` / `BLUE_BG_ON` / `BLUE_BORDER` / `BLUE_BORDER_ON`.
- `#04060F` written literally at ~10 networking sites → `T.INK_ON_ACCENT`.
- `#1a0505` (ink on red) had no token → `T.INK_ON_ERROR`.
- `rgba(254,176,106,0.05)` glow → `T.ORANGE_GLOW`.

**Raised and deliberately not "fixed":** the two greens (§1), blue's three meanings (§5).
