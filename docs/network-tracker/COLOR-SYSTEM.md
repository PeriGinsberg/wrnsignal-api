# Networking colour inventory

An audit of every colour in use across the networking screens, taken 2026-07-30 at
commit `2d1a3ef8`. **Nothing was changed.** This is the inventory we agreed to take
before defining one meaning→colour rule set for the whole function.

Sources: `lib/dashboard-theme.ts` (tokens + `PHASE`), `app/dashboard/network/vocab.ts`
(stage→phase map), and every `T.*` / literal colour under `app/dashboard/network/`.

---

## 1. The phase palette — 7 colours

Defined in `dashboard-theme.ts:69-77`, applied only through `pillStyle()` →
`stagePillStyle()` (`vocab.ts:52`). The stage→phase mapping is `STAGE_PHASE`
(`vocab.ts:36`). Appears on: stage pills in the contacts spreadsheet, the contact
record's phase bar, `ChangeStage`, and the dashboard funnel.

| Phase | fg | Meaning | Stages |
|---|---|---|---|
| `idle` | `rgba(255,255,255,0.62)` | not started | identified |
| `active` | `#51ADE5` | in progress | intro_requested, sequence_active |
| `alive` | `#4ade80` | **replied** | replied |
| `momentum` | `#a7f3d0` | chat booked/done | chat_scheduled, chat_done |
| `longgame` | `#c4b5fd` | nurture / ask | nurture, ask_made |
| `won` | `#FEB06A` | outcome | outcome |
| `resting` | `rgba(255,150,150,0.78)` | dormant | dormant_no_answer, dormant_declined |

## 2. Everything outside the phase palette

| Colour | Token | Value | Meaning(s) as used | Where |
|---|---|---|---|---|
| Warm | `T.WRN_ORANGE` | `#FEB06A` | attention needed; the outreach sequence | nav active tab, "Due today", ActionBox, snooze override, worklist late count, profile required-empty dot + MOST USEFUL badge, import "not a person?", Templates sequence rail + step circles |
| Green | `T.SUCCESS` | `#4ade80` | saved OK; the replies group | save ticks (contact record ×2, SendPanel, Templates), banners (contacts, companies, profile), filled-field ✓, target met, import success, Templates Replies rail + labels |
| Blue | `T.WRN_BLUE` | `#51ADE5` | link; unsaved edit; progress bar | all links, SendPanel + TemplateEditor dirty border, dashboard bars, ChangeStage selected outcome |
| Pink | `T.WRN_PINK` | `#EC4899` | LinkedIn | Templates LinkedIn rail + labels **(only site)** |
| Red | `T.ERROR` | `rgba(255,120,120,0.95)` | error; overdue; destructive | ~28 sites; `ContactRow:55` overdue; delete buttons |
| Amber tint | `T.WARNING_BG` | `rgba(254,176,106,0.08)` | edited; late | SendPanel scratchpad, WorklistRow late row, dropped-variable warning, Templates edited pill |

---

## Collisions and inconsistencies

### A. The Replies green and the "replied" green are the same shade but not the same token
**Direct answer to the question asked.** `T.SUCCESS` is `#4ade80`; `PHASE.alive.fg` is
`#4ade80`. Byte-identical, declared independently ~55 lines apart. They agree today by
coincidence, not by construction — change one and the other silently diverges. This is
the single highest-value fix in the audit, because the meaning genuinely *is* shared
("they responded") and the coupling should be real.

### B. Green carries three unrelated meanings
1. "replied" (phase), 2. "saved successfully" (13 sites), 3. "the replies group"
(Templates). 1 and 3 are the same idea. **2 is not** — an operation succeeding has
nothing to do with a contact responding, and it is the most frequent use of the colour
on the whole function.

### C. There are two greens, adjacent in both hue and meaning
`PHASE.alive #4ade80` (replied) and `PHASE.momentum #a7f3d0` (chat booked/done) sit next
to each other in the funnel and are both green. Whatever rule we write has to say why
"they replied" and "we spoke" are different colours, or merge them.

### D. Warm means three things, one of which is an end state
`T.WRN_ORANGE` = `PHASE.won.fg` exactly. So warm is simultaneously **"needs your
attention"** (due today, required-empty, late), **"outcome reached / done"** (phase pill),
and now **"the outreach sequence"** (Templates). Attention and done are close to
opposites. This is the worst collision in the set.

### E. The amber tint means both "edited" and "late"
`T.WARNING_BG` backs the SendPanel's edited scratchpad, the worklist's late row, and the
Templates edited pill. Edited is neutral; late is a problem.

### F. Blue means link, in-progress, and unsaved
`#51ADE5` is `PHASE.active.fg` *and* every hyperlink *and* the dirty-textarea border.

### G. Pink is the only colour with exactly one meaning and no collision
No pink anywhere in `PHASE`. Nearest neighbour is `resting rgba(255,150,150,0.78)`
(dormant) — a desaturated salmon. Distinguishable, but they can co-occur on a contact
row, so worth a deliberate check rather than an assumption.

### H. Three different strengths of the same warm border
`T.ORANGE_BORDER` `0.35` (token) · `Field.tsx:28` `0.45` (required-empty) ·
`Field.tsx:44` `0.55` (featured). The latter two are literals.

### I. Literals that duplicate or near-miss a token
- `contacts/page.tsx:294` — `rgba(74,222,128,0.3)` vs `T.SUCCESS_BORDER` `0.35`. Near-miss.
- `SendPanel.tsx:264` — `rgba(254,176,106,0.35)` is exactly `T.ORANGE_BORDER`, written raw.
- `ChangeStage.tsx:134,136,150` — blues at `0.10/0.15/0.35/0.4`; no blue tint tokens exist.
- `ActionBox.tsx:35,36` — warm at `0.38` and `0.05`.
- `#1a0505` (`contacts/page.tsx:461`, `[contactId]/page.tsx:245`) — a second ink colour for
  text on red, with no token. `#04060F` now has one (`T.INK_ON_ACCENT`) but ~10 networking
  sites still write it literally.

---

## What this implies for the rule set

Three questions to settle before any colour moves:

1. **Does "replied" own green outright?** If yes, save-confirmations need a different
   signal (blue, or no colour at all), and `T.SUCCESS` and `PHASE.alive` become one token.
2. **What does warm mean — attention, or done?** It cannot keep meaning both. If warm is
   attention, `PHASE.won` needs a new colour; if warm is done, every due/late/required
   affordance needs one.
3. **Is a group identity the same kind of thing as a status?** Templates uses colour for
   *which family a template belongs to*; the pipeline uses it for *what state a contact is
   in*. If both stay, they need visually separate roles (e.g. status = filled pill, group
   = 3px rail) so one is never read as the other.

Not addressed here: the coach surfaces (`app/dashboard/coach/**`) carry their own avatar
palette including a soft pink `#F4ADC9`. Out of scope for the networking function, but it
is a fourth pink in the product.
