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

**Status = dot + text. Group identity = 3px left rail.**

> **Amended 2026-08-03.** Status was "a filled pill" from the original audit until the light
> theme landed. It is now a coloured dot plus plain coloured text (`status()` in
> `lib/theme/surfaces.ts`). The reason is the action rule in §6.9: a filled pill looks
> tappable, and on light the only tappable-looking thing is allowed to be a peach action
> button. The dark theme still renders status as pills, and `pill()` is retained for that
> plus chips and counts. The original wording is kept below because the rail half of the
> rule is unchanged and the pill half is still live on dark.

A colour may carry both a status and a group meaning **because the shape disambiguates**:

- A **status mark** always answers *what state is this contact in?* (`status()` on light,
  `pillStyle()` on dark)
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
| Light theme tokens (`lib/theme/surfaces.ts`) | ✅ done 2026-08-03, see §6. No screen consumes them yet |
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

## 6. The light theme (APPLIED to tokens 2026-08-03)

The ground lightens and navy becomes structure. The token set below is product-wide, not
networking-only, and is **live in `lib/theme/surfaces.ts`**. No screen consumes it yet:
the redesign applies it screen by screen, starting with the nav shell. The dark tokens are
unchanged and dormant, so light is a token flip rather than a deletion.

### 6.1 The problem this had to solve

The dark palette separates several meanings by LIGHTNESS, not hue. On white every colour
has to darken to clear 4.5:1, which compresses the whole set into one narrow luminance
band and collapses exactly those pairs. Measured, on a first pass of naive darkening:

| Pair | Hue gap | Luminance ratio | Verdict |
|---|---|---|---|
| in-progress blue vs sequence ice | 11 deg | 1.01 | collapsed |
| attention warm vs done gold | 16 deg | 1.06 | collapsed |
| replied green vs we-spoke mint | 21 deg | 1.09 | collapsed |

On the dark theme ice blue beat `WRN_BLUE` by luminance `0.933` against `0.373`. Darkening
both for white throws that separation away.

**The fix is structural, not another hue hunt.** Every meaning gets THREE values on light.
The measurement that forces it: **no brand hue clears 4.5:1 as text on white.**

| Hue | As text on white |
|---|---|
| Peach `#FEB06A` | 1.81 |
| Blue `#51ADE5` | 2.48 |
| Gold `#D4A444` | 2.28 |
| Pink `#FF8FB0` | 2.14 |
| Purple `#B679E0` | 3.09 |
| Red `#E5484D` | 3.91 |
| Teal `#218C8C` | 4.04 |

So a meaning cannot be one hex on light. It is three, each with one job:

- **`ink`** the darkened value, for status TEXT and the status DOT, both the same value so a
  mark and its label match. Also icons.
- **`accent`** the brand hue at full chroma, for initial tiles, 3px group rails, progress
  fills and orb gradients. Structural colour, never text.
- **`fill`** the pale tint, for chips and soft backgrounds, always with its own `ink` on top.

Pairs that collapsed as two inks no longer meet as two inks. A status is a dot plus text; a
group rail is a bar of `accent`. The §2 shape rule does the separating, and it does more work
on light than it ever had to on dark.

### 6.2 Surfaces

| Role | Value | Note |
|---|---|---|
| Page | `radial-gradient(120% 120% at 50% 0%, #f0f9fc 0%, #e6f4f9 100%)` | the cool ground, gently glowing, not flat |
| Page flat | `#EAF5FA` | solid fallback where a gradient cannot go |
| Card | `#FFFFFF` | white, lifted by shadow |
| Raised / active card | `#FFFFFF` | same colour, more elevation |
| Input well | `#F4F8FB` | recessed a step below the card |
| Border | `#DCE6EF` | hairline on light |
| Border soft | `#E8EFF5` | for internal dividers |
| Shadow, card | `0 1px 2px rgba(19,41,74,0.04), 0 4px 12px rgba(19,41,74,0.06)` | navy tinted, never black |
| Shadow, raised | `0 2px 4px rgba(19,41,74,0.05), 0 10px 28px rgba(19,41,74,0.10)` | the lift for an active card |

**Cards separate by shadow, not by tint.** White against the ground is a 1.13:1 luminance
step, which is deliberate: elevation carries the separation and the ground stays calm. This
reverses the earlier proposal, where the base card was off-white so a raised card had
somewhere brighter to go. `raised` and `card` are now the same white, and a component asks
for `surfaceCard(s, lifted)` to get the right shadow. If a future component genuinely needs a
surface brighter than white, add a token then rather than reserving one now.

A black shadow on a blue ground reads as dirt, which is why every shadow is navy tinted.

### 6.3 Text on light

| Role | Value | On card | On ground | On well |
|---|---|---|---|---|
| Primary | `#13294A` | 14.55 | 12.93 | 13.62 |
| Secondary | `#3D5878` | 7.33 | 6.52 | 6.86 |
| Muted | `#526C87` | 5.45 | 4.85 | 5.15 |
| Dim | `#8299B3` | 2.93 | 2.61 | 2.75, decorative and placeholder only |

Primary text is the structural navy itself, which is what keeps the two themes feeling like
one product. `muted` moved from `#5E7A99`, which measured 3.96 on the ground and would have
failed on every page. All values are now measured against three surfaces, not one, because
the ground is a surface text actually sits on.

### 6.4 Every meaning, re-tuned for white

Meaning is preserved; only the surface flipped. Every `ink` clears 4.5:1 on all three light
surfaces (card, ground, well) and on its own `fill`. The `ink worst` column is the lowest of
the three, so it is the number that actually has to hold.

| Meaning | Ink | Accent | Fill | ink worst | ink on fill |
|---|---|---|---|---|---|
| Attention, act here, overdue | `#95500E` | `#FEB06A` | `#FDECD9` | 5.44 | 5.30 |
| Current position on a path | `#93245F` | `#E5397E` | `#FBDCEB` | 7.02 | 6.22 |
| Responded / alive | `#17706F` | `#218C8C` | `#D6EFEC` | 5.21 | 4.86 |
| We actually spoke | `#0F5C55` | `#1B7A72` | `#CDEAE4` | 6.96 | 6.15 |
| Achieved / done | `#8A6410` | `#D4A444` | `#F7EBCC` | 4.77 | 4.53 |
| In progress | `#1F6FA8` | `#51ADE5` | `#DCEDF9` | 4.79 | 4.50 |
| The sequence (group) | `#0F6478` | `#DCFEFF` | `#DCFEFF` | 6.00 | 6.31 |
| LinkedIn (group) | `#C2185B` | `#FF8FB0` | `#FDE3EC` | 5.22 | 4.86 |
| Long game | `#7B3FB5` | `#B679E0` | `#EDE4F9` | 5.80 | 5.30 |
| Dormant / resting | `#6E5C79` | `#A98FB8` | `#EFEAF3` | 5.38 | 5.11 |
| Error / destructive | `#C0322F` | `#E5484D` | `#FBE4E3` | 4.99 | 4.63 |
| Not started | `#4E6B88` | `#D3DCE6` | `#E9EEF4` | 4.94 | 4.76 |

Two notes on the accent column. The two icon-family accents, pink `#FF8FB0` and purple
`#B679E0`, land as the accents for LinkedIn and long game, so the icon set and the meaning
set share one vocabulary instead of drifting apart. And the green that carried "responded" on
dark becomes teal on light: `#218C8C` is the brand's own colour and the light palette has no
separate green, so the two-step progression in §1 is now teal into deeper teal rather than
green into mint.

The fill-at-send bracket keeps the attention warm, exactly as on dark. One meaning, one
place in the table, both themes.

### 6.4a Orbs

Primary actions and navigation choices render as glowing gradient orb-buttons. Text sits
across the whole sweep, so the ink has to clear 4.5:1 at **every stop**, not on average.

| Orb | Gradient | Ink | Worst stop |
|---|---|---|---|
| Peach, network and act | `#FEB06A` to `#F0913F` | navy `#13294A` | 6.11 |
| Blue, track and info | `#7FC8EF` to `#4FA3D8` | navy `#13294A` | 5.24 |
| Teal, score and JobFit | `#1B7A72` to `#16605C` | white `#FFFFFF` | 5.16 |

Light-tinted orbs take navy ink; the one saturated orb takes white. White on the mockup's
lighter blue measured 2.48 and was rejected. Keeping blue light and flipping its ink to navy
preserves the intended look and matches what peach already does.

### 6.4b The navy hero

Navy is structure on light: the nav, hero panels and initial tiles.

| Role | Value | On navy |
|---|---|---|
| Background | `radial-gradient(70% 90% at 88% 6%, rgba(254,176,106,0.16), transparent 62%), radial-gradient(120% 140% at 12% 0%, #1B3A63 0%, #13294A 55%, #0E1F38 100%)` | 11.46 for white |
| Ink | `#FFFFFF` | 14.55 |
| Muted | `#9DB6D0` | 6.95 |
| Link | `#7FC4EC` | 7.63 |
| Accent, progress fills | `#FEB06A` | 8.06 |

Carried over from the dark theme's hero, which is why the navy panels already look like
SIGNAL rather than like a new app.

### 6.5 The two tight pairs, and why they are safe

`blue ink` vs `ice ink` is a luminance ratio of 1.02, and `warm ink` vs `gold ink` is 1.02.
Both are fine because **neither pair ever meets as two inks**:

- In-progress is a status, so it appears as ink on its fill inside a pill. The sequence is a
  group, so it appears as a rail. Blue pill ink against ice rail fill measures **5.77**.
- Attention is text, a border or an icon. Done is a status pill. Warm text against a gold
  pill fill is the comparison a reader actually makes, never warm ink against gold ink.

This is the §2 shape rule earning its keep. If a future screen puts two inks side by side
it breaks, so that is the thing to check when applying, not the hex values.

### 6.6 Gradient buttons

`GRAD_PRIMARY` (`#FEB06A` to `#51ADE5`) was built for a dark surface and reads washed out on
white. It stays the dark theme's.

An earlier draft of this section made the light primary button solid navy with white text,
on the grounds that peach read washed out. **That is superseded.** The judgement was made
while peach also had to serve as the attention meaning, which forced it to be legible as
text and therefore darkened past the point where it looked like the brand. Now that peach is
action only (§6.9) it can stay at full chroma and take navy ink at 6.11:1. The light primary
is the peach gradient `#FEB06A` to `#F0913F` with navy `#13294A` ink.

### 6.7 Token structure

Written so this is not networking-only:

```ts
// lib/theme/surfaces.ts
export type Meaning = { ink: string; accent: string; fill: string }
export type Surface = {
  name: "dark" | "light"
  page: string; pageFlat: string; card: string; raised: string; well: string
  border: string; borderSoft: string; shadow: { card: string; raised: string }
  text: { primary: string; secondary: string; muted: string; dim: string }
  meaning: Record<MeaningKey, Meaning>
  row: RowOverlays
  action: Action; hero: Hero; orb: Record<"peach" | "blue" | "teal", OrbStyle>
}
export const DARK: Surface = { ... }   // unchanged, dormant
export const LIGHT: Surface = { ... }  // the tables above
```

Components read `surface.meaning.replied.ink` rather than `T.SUCCESS`, so a screen is themed
by which `Surface` it is handed. Existing `T.*` stays exported and unchanged during the
migration, so no screen breaks while they move across one at a time.

Helpers, all taking a `Surface` first:

| Helper | Returns |
|---|---|
| `status(s, key)` | `{ dot, text }`, both the meaning's ink. The status shape. |
| `rail(s, key \| null)` | 3px left border of the meaning's accent. Null keeps the inset. |
| `action(s, tier)` | The one action shape. `primary` filled peach, `optional` outline. |
| `orb(s, key)` | Gradient fill, colour glow, the ink that survives every stop. |
| `surfaceCard(s, lifted)` | Card background, border and the right elevation shadow. |
| `tile(s, key)` | Phase-coloured initial tile, built on `accent`. |
| `tileStructural(s)` | The navy initial tile for an active card. |
| `tileIdle(s)` | The flat colourless tile for something nobody has worked yet. |
| `pill(s, key)` | Retained for chips, counts and dark-theme status. Not the light status shape. |

### 6.8 Resolved, and what is still open

Resolved since the proposal:

- **The page lightens.** It is the cool light-blue radial ground, not navy. Navy becomes
  structure only: nav, heroes, initial tiles.
- **The row overlays** are dark-alpha on light: stripe `rgba(19,41,74,0.030)`, hover
  `rgba(19,41,74,0.055)`, selected `rgba(31,111,168,0.10)`, flash `rgba(31,111,168,0.20)`.
- **Light ships, dark stays dormant.** Not deleted, so a toggle remains possible.

Still open:

- Whether dark is ever offered as a user choice, or stays an internal fallback.
- Whether the coach surfaces adopt the light theme in stage 2 or keep their own treatment.

### 6.9 Peach is action, and only action

The rule that the whole light theme hangs on: **an action is always a filled peach button,
and peach appears nowhere else.** This makes "what do I click" unmistakable on a page with no
other tappable-looking colour.

It is enforced structurally, not by convention. On light, peach is **not reachable through
`meaning`**. It lives in `action` and `orb.peach`, so a status lookup cannot return it:

| Role | Token | Value |
|---|---|---|
| Action fill | `action.fill` | `linear-gradient(135deg, #FEB06A, #F0913F)` |
| Action ink | `action.ink` | `#13294A`, 6.11 at the darkest stop |
| Action glow | `action.glow` | `0 2px 6px rgba(240,145,63,0.28), 0 8px 20px rgba(240,145,63,0.18)` |
| Optional tier border | `action.outlineBorder` | `#F0913F` |
| Optional tier ink | `action.outlineInk` | `#95500E`, 6.12 on white |
| Quiet inline link | `action.quietInk` | `#1F6FA8` |
| Attention as TEXT | `meaning.attention.ink` | `#95500E`, for "none yet" and overdue |
| Attention as structure | `meaning.attention.accent` | `#FEB06A`, for rails and tiles only |

**Attention and action have split on light and stay one colour on dark.** §1's "warm owns
attention, and only attention" is still true of the dark theme. On light the sentence
becomes two: peach owns *action* as a fill, and darkened peach owns *attention* as text. They
never collide because they never appear in the same shape. This is the same reasoning that
moved `PHASE.won` off `#FEB06A` to gold in §1, applied one level up.

The action tiers, from the build plan:

1. **Filled peach** means do this now.
2. **Outline** means optional, for example "Apply" on a job that is only saved.
3. **Nothing** means no action. The absence of a button, never a disabled one, because a
   greyed button still reads as a thing you failed to earn.

---

### 6.10 Rose owns "where you are" (2026-08-04)

Amber was marking the current step on the contact record's stepper, borrowed from
`meaning.attention`. That was the wrong word for it. **Attention means something needs you.
The current step means this is where you stand**, which is often true with nothing owing at
all: a contact you messaged yesterday is at "Message sent" and needs nothing today. Two
different questions were sharing one colour, and a screen can legitimately ask both at once.

Rose is now its own meaning, `meaning.current`:

| Role | Token | Value | Measured |
|---|---|---|---|
| The ring on the current step | `meaning.current.accent` | `#E5397E` | 4.02 on white, non-text, needs 3.0 |
| The numeral and the label | `meaning.current.ink` | `#93245F` | 7.02 on the worst light ground |
| The circle's fill | `meaning.current.fill` | `#FBDCEB` | carries the ink at 6.22 |

**Why the ink is not simply the accent darkened.** Rose `#E5397E` and the LinkedIn pink
`#FF8FB0` sit on the *same hue*, 336. The accents are far enough apart to name, 17.5 dE2000,
so the pair the brief asked about is safe. But their inks are not: the LinkedIn ink `#C2185B`
**is** a darkened rose, and every straight darkening of `#E5397E` that clears 4.5:1 lands
within about 4 dE of it, which is "the same colour, slightly off" rather than a difference
anyone would name. Hue cannot separate two hues that are equal, so lightness does the work.
`#93245F` sits 10.7 dE from the LinkedIn ink, stays rose at hue 328, and clears every ground
with room. Distances to everything else it could be confused with: error ink 22.9, long-game
ink 19.5, attention ink 36.8.

The two fills, `#FBDCEB` and LinkedIn's `#FDE3EC`, remain close at 3.0 dE. Accepted, on the
same terms as §5: they are pale backgrounds that never carry meaning alone, each always has
its own ink on top, and they have no screen in common. Recorded so it is a decision rather
than an oversight.

Peach is untouched by this. The ring is rose, and §6.9 still holds: the only peach on the
contact record is the send button.

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
