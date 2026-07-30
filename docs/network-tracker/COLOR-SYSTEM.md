# Networking colour system

The meaning→colour map for the networking function. **These rules are definitive.**
A colour is chosen by looking up the meaning here, never by picking something that
looks right. That is how the collisions in the appendix happened.

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
| **The sequence · your active outreach** *(group identity)* | ice blue `#DCFEFF` | `T.ICE_BLUE` |
| **The replies** *(group identity)* | green `#4ade80` | `T.SUCCESS` |
| **LinkedIn** *(group identity)* | pink `#EC4899` | `T.WRN_PINK` |
| **Long game (nurture/ask)** | violet `#c4b5fd` | `PHASE.longgame.fg` |
| **Dormant / resting** | salmon | `PHASE.resting.fg` |
| **Not started** | white 62% | `PHASE.idle.fg` |
| **Error · destructive** | red | `T.ERROR` |
| **Neutral confirmation** | muted white | `T.MUTED` |

### Warm owns attention, and only attention
Warm is the send button, overdue dates, required-empty fields, the late-worklist row,
the fill-at-send bracket. It is **not** "done". `PHASE.won` moved off `#FEB06A` to
`T.GOLD`, a deeper gold that reads accomplished rather than urgent, because attention
and done are close to opposites and cannot share a hex.

### Green means "they responded", not "it worked"
`T.SUCCESS` and `PHASE.alive.fg` are now **one token**, not two hexes that happened to
agree. Save-confirmations moved OFF green to `T.MUTED`: a save succeeding is not news
about a contact. The Templates "Replies" group keeps green, because those genuinely are the
reply messages.

### The two greens are deliberate
`alive #4ade80` ("they responded") and `momentum #a7f3d0` ("we actually spoke") are a
**two-step progression inside the same good news**, which is why they are adjacent in hue
as well as in the funnel. This is a designed step, not a duplication. Do not collapse them.

---

## 2. The shape rule: what prevents the next overload

**Status = filled pill. Group identity = 3px left rail.**

A colour may carry both a status and a group meaning **because the shape disambiguates**:

- A **filled pill** always answers *what state is this contact in?* (`pillStyle()`)
- A **3px left rail + coloured section header** always answers *what family is this?*

Green in a pill means the contact replied. Green on a rail means the Replies section.
No reader confuses them, and no future screen has to invent a third convention. Any new
use of colour must pick one of these two shapes, or state why it is neither.

### A group colour must carry no other meaning
The Templates sequence went warm → neutral → **ice blue**, and the path is the lesson.
Warm was wrong because warm means "act here", and a sequence card was showing a warm rail,
warm step circles *and* warm fill-at-send brackets, three warm things meaning three
different amounts. Neutral fixed the collision but cost the sequence its identity and its
filled step circles. Ice blue gives both back in a colour that means nothing else here.

The rule that survives: **a group identity may only use a colour with no competing meaning
on the function.** Warm, green, gold and red were all unavailable to the sequence for that
reason. `railStyle()` still accepts `null` for an uncoloured group, and a `null` rail keeps
the identical 14px inset via a transparent border so headings stay aligned either way.

---

## 3. Brackets: the rule inside a message body

Applied in the Templates editor and its live preview (`brackets.tsx`).

| Bracket | Meaning | Colour |
|---|---|---|
| `[NAME]`, `[FIRM]`, `[CITY]`, `[CURRENT_ROLE]` … | fills itself in | calm `T.MUTED` |
| `_____` (profile blank, not yet filled) | fills itself in, once you complete your profile | calm `T.MUTED` |
| `[MUTUAL]`, `[OPTION 1]`, `[ONE SPECIFIC QUESTION]` … | **you write this** | warm `T.WRN_ORANGE`, bold |

This is the same warm = *your action* rule as overdue and required-empty: a blank you have
to fill is the part of the message that needs you. The split is not re-derived:
`classifyVariable()` in the 8b renderer stays the only authority on which bracket is which.

Implementation note: colouring inside an editable body needs a highlight layer behind a
transparent textarea. Both read one shared `BODY_BOX` style object; if they ever drift,
text slides off its own highlight.

**The "Insert field ▾" menu carries the same two colours**. Its "You fill this in" section
renders warm, "About you" and "About them" calm, so the menu teaches the split rather than
just listing it. Its grouping comes from `classifyVariable()` too, which is why the menu and
the body cannot disagree about what a variable is.

**Its group headers follow the same auto/manual split, one register up:**

| Header | Colour | Because |
|---|---|---|
| About you · About them | ice blue `T.ICE_BLUE` | auto-fill, the "fills itself" colour |
| You fill this in | amber `T.WRN_ORANGE` | your job to write |

Two colours for three headers is deliberate: the distinction that matters is auto vs manual,
and the two auto sections stay apart on their own words. Note the header and its items sit in
different registers on purpose: a header states what the *group* is (ice blue = fills itself),
while items keep the colour their bracket takes in the body (calm `T.MUTED` for auto, warm for
fill). Colouring auto items ice blue too would make the menu disagree with the message body.

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
| Templates: sequence section → ice blue | ✅ done |
| Contacts spreadsheet | ⏳ not yet applied |
| Dashboard / funnel | ⏳ not yet applied (inherits the gold change) |
| Profile | ⏳ not yet applied |

---

## 5. Known, accepted overlaps

- **Ice blue and `WRN_BLUE` are both blue-family.** Checked rather than assumed:
  ice is luminance `0.933`, `WRN_BLUE` `0.373`, a `2.32:1` ratio between them, and
  `15.44:1` vs `6.64:1` against the card navy. Ice reads near-white with a cyan cast,
  `WRN_BLUE` reads as a blue. Distinct at rail and step-circle size. Also `T.ICE_BLUE` is
  the pale cyan JobFit already uses on its Internship pill, a different function, same
  accepted-overlap footing as `T.GOLD`.
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

## Appendix: the original audit, and what it found

The state before these rules, kept because it is the evidence for them.

**Fixed by this pass:**
- `T.SUCCESS` and `PHASE.alive.fg` were the same hex declared twice, ~55 lines apart,
  agreeing by coincidence. Now one token.
- `T.WRN_ORANGE` was exactly `PHASE.won.fg`, so warm meant attention *and* done.
- Green carried three meanings; the most frequent (save confirmation) was unrelated to the
  other two.
- Three warm border strengths (`0.35` token, `0.45`/`0.55` literals in `Field.tsx`), plus
  strays at `0.38` and `0.30`, now `ORANGE_BORDER` / `_MED` / `_STRONG`, with the two
  strays snapped to the nearest step (a ≤0.05 alpha change, invisible).
- `rgba(74,222,128,0.3)` near-missing `SUCCESS_BORDER` `0.35`.
- Untokenised blues at `0.10/0.12/0.15/0.35/0.40` in `ChangeStage` and `WorklistRow`,
  now `BLUE_BG` / `BLUE_BG_ON` / `BLUE_BORDER` / `BLUE_BORDER_ON`.
- `#04060F` written literally at ~10 networking sites → `T.INK_ON_ACCENT`.
- `#1a0505` (ink on red) had no token → `T.INK_ON_ERROR`.
- `rgba(254,176,106,0.05)` glow → `T.ORANGE_GLOW`.

**Raised and deliberately not "fixed":** the two greens (§1), blue's three meanings (§5).
