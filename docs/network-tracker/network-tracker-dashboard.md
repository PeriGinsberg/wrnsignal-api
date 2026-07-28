# Network Tracker — Dashboard & Spreadsheet View

Add to `docs/network-tracker/` as `DASHBOARD.md`. Extends the reconciliation doc (§9
Metrics), which this replaces in full.

Two views, no new tabs. The strip is **Dashboard · Contacts · Companies**.

- **Dashboard** (`/dashboard/network`) — the worklist with metrics beneath it. The tab was
  called "Today" when this was written; renamed so the three tabs read as siblings.
- **Contacts** (`/dashboard/network/contacts`) becomes the spreadsheet view, **replacing**
  the current roster.

---

## Part 1 — the Dashboard view

> **BUILT (Phase 9).** Four things changed between spec and build; this document
> records the built behaviour, not the original intent:
> 1. **Seven phase groups, not six.** `resting` is a full group rendered inline in the
>    funnel, not a sidebar count — same grouping and colours as the contact record's
>    phase bar and the stage pills, all reading `STAGE_PHASE` / `PHASE_ORDER`.
> 2. **Client-side, not an aggregate route.** No `GET /api/network/summary`. The page
>    fetches the contacts list it already has access to and computes everything in
>    `app/dashboard/network/dashboardMetrics.ts` (pure functions). Four columns were
>    added to the contacts select to support it — `first_touch_at`, `first_replied_at`,
>    `first_chat_at`, `outcome_type` — additively, no migration. Extract a route later
>    only if it gets slow.
> 3. **"Follow-ups completed this week" is DEFERRED.** `touch_2`/`touch_3` counts live in
>    `network_actions`, which the dashboard deliberately does not fetch. The first-touch
>    half against the 5–8 target ships, derived from `first_touch_at >= Monday`.
> 4. **The benchmark line gates on `reached >= 10`,** not on "≥10 contacts finished all
>    three touches" — per-contact touch counts need `network_actions` for the same
>    reason. Reached is an honest proxy and the copy says so ("Once you've reached 10+
>    contacts…"), keeping the targeting-vs-messaging interpretive line intact.

**The founding rule still holds: the due list is the product.** It stays the dominant
element. Metrics sit *below* it, not above. A user who opens this page must see who to
contact today before they see a single number.

### Layout, top to bottom

**1. Due now — the worklist.** Unchanged in function. Overdue first, reason stated, quick
actions inline. This is most of the screen.

**2. This week — the activity bar.** The spreadsheet's target: *5-8 new first touches per
week, plus every follow-up that comes due.*

- First touches since Monday, against a target of 5-8, as a progress bar. **BUILT** from
  `first_touch_at`, which is stamped once on the first touch — no actions fetch needed.
- ~~Follow-ups completed this week (touch_2 + touch_3)~~ — **DEFERRED**, needs
  `network_actions`. Revisit with the aggregate route, if one is ever extracted.
- One line of plain feedback: "3 of 5 first touches this week" / "Target met — 6 first
  touches"

This is the engagement metric. It measures effort, which the client controls, rather than
replies, which they don't. Put it directly under the worklist.

**3. The funnel.** Eleven stages is too many to show as eleven bars. Collapse to **seven
phase groups** — six that render as the horizontal funnel, plus `resting` alongside it:

| Group | Phase key | Stages | Colour intent |
|---|---|---|---|
| Not started | `idle` | `identified` | grey |
| In progress | `active` | `intro_requested`, `sequence_active` | blue |
| Replied | `alive` | `replied` | green |
| Talking | `momentum` | `chat_scheduled`, `chat_done` | green, stronger |
| Nurture & ask | `longgame` | `nurture`, `ask_made` | purple |
| Outcome | `won` | `outcome` | gold |
| Resting | `resting` | `dormant_no_answer`, `dormant_declined` | muted red |

**This mapping is not duplicated here — it is code.** The single source of truth is
`STAGE_PHASE` in `app/dashboard/network/vocab.ts`, with the palette in
`PHASE` / `pillStyle()` in `lib/dashboard-theme.ts`. The funnel, the Contacts stage
pill, and every future stage surface all read from it. The table above documents that
constant; it must never be re-declared. Supporting exports: `PHASE_LABELS` (display
names), `PHASE_ORDER` (canonical order), `FUNNEL_PHASES` (order minus `resting`), and
`stagesInPhase(phase)` (for deep-link filters).

**BUILT: `dormant_no_answer` and `dormant_declined` render INSIDE the funnel** as the
seventh group, not beside it. The original "beside" placement predates the seven-group
decision; keeping them out would have meant the funnel and the phase bar showing the
same contact in different places. How many resurface in the next 7 days survives as a
needs-attention row rather than a sidebar count.

They are a full member of the colour mapping (`resting`) because colouring dormant the
same grey as "not started" misleads: one has never been contacted, the other has been
contacted and gone quiet. That distinction is exactly why this is seven groups, not six.

Every group is clickable and deep-links to Contacts as **`?phase=<key>`** — a single
query param filtering on `STAGE_PHASE[c.stage]`, not an expansion of `stagesInPhase()`
into a stage list. The Contacts filter takes one stage at a time, so a group of several
stages could not be expressed by the existing `?stage=` param; `?phase=` reads the same
shared constant the funnel counts with, so a deep-linked group always shows exactly the
people it counted. Phase 9 also added `?relationship=__none__` and `?status=stalled` for
the needs-attention rows, for the same reason: a row you cannot click is a fact you
cannot act on.

**4. Conversion — three numbers with denominators that are actually defined.**

| Metric | Definition |
|---|---|
| Reached | contacts with a `touch_1` action logged |
| Reply rate | contacts who reached `replied` or beyond ÷ Reached |
| Chat rate | contacts who reached `chat_scheduled` or beyond ÷ replied |
| Outcomes | contacts at `outcome`, split by `outcome_type` |

"Or beyond" matters: a contact now at `nurture` replied at some point. Counting only
current stage would show a reply rate that falls as things go well.

Show the spreadsheet's benchmark inline, since it's the interpretive key: *fewer than 1
reply in 10 after all three touches usually means the targeting was too broad, not that
the messages were bad.* **BUILT: gated on `reached >= 10`** (see the note at the top of
Part 1 — touch counts are not available client-side). Below the gate the panel says to
reach 10+ before reading much into the rate, rather than displaying a number that swings
on a single reply.

**5. What's working — the split that earns its keep.**

Reply rate broken down two ways:

- **By `relationship`** — personal / affinity / referred / cold / recruiter
- **By `segment`** — whichever target lists the client is running

This is the whole reason both fields exist. The spreadsheet's claim is that affinity is
the highest-converting cold-adjacent category by a wide margin; this is where a client
sees whether that's true for them, and where a coach sees that a segment is dead.

Small horizontal bars, count alongside each rate, and suppress any row with fewer than 5
reached (n too small to mean anything — say so rather than showing a rate).

**6. Needs attention — the honest bit.**

A short list, only shown when non-empty:

- Contacts stalled in `sequence_active` with no action in 14+ days
- Priority A contacts still at `identified`
- `dormant_*` contacts resurfacing this week
- Contacts with no `relationship` set (they can't be assigned a template)

Each links straight into a filtered Contacts view.

### What NOT to build in v1

- **No trend-over-time.** Every number here is a snapshot. History means a daily
  aggregates table and a job to fill it, which is a phase of its own. A reply rate of 14%
  is useful on its own; "up 2% from last week" is not worth the machinery yet.
- No date-range picker. Everything is all-time except the weekly activity bar.

---

## Part 2 — Contacts, as a spreadsheet view

Replaces the current roster outright. One list of contacts, not two.

### Columns

Company · Name · Title · Relationship · Segment · Priority · Stage · Last touch · Next due
· Status

`Status` is the computed one, coloured: **OVERDUE** (red) / **Due today** (amber) /
**Due in N days** (neutral) / **—** (no due date).

Name links to the contact record. Everything else stays put.

### Inline actions — exactly three

Locked, per the Coach:

1. **Log the due touch** — the button names the actual action (`touch_2`, `thank_you`),
   derived from `next_due_reason`. One click.
2. **Snooze** — 3 / 7 / 14 days.
3. **Change stage** — dropdown.

Anything else — notes, backdating, action history, editing fields — belongs on the contact
record. Full inline editing would duplicate the contact page and double the surface where
the engine can be called incorrectly.

### Filters and sort

Filters: stage, relationship, segment, priority, company, standalone-only, and status
(overdue / due today / not started).

Default sort stays: no-activity first, then most-recently-active. A just-added contact must
never be buried.

The dashboard's funnel groups and "needs attention" rows deep-link here with filters
pre-applied — that's the mechanism that makes the dashboard actionable rather than
decorative.

---

## Part 3 — Build notes

**One aggregate route.** `GET /api/network/summary` returns every dashboard number in one
call. Do not compute these client-side across a full contact fetch, and do not issue eight
count queries.

**Reply rate needs "or beyond."** Current stage alone can't tell you whether someone ever
replied. Two options — decide before building:
- (a) derive it from the action log and stage ordinality, or
- (b) store `first_replied_at` on the contact, stamped on the first transition into
  `replied`.

(b) is cheaper to query and survives a contact being moved backwards. Recommend (b), plus
`first_touch_at` and `first_chat_at` by the same logic. Three nullable timestamps, stamped
once, never recomputed.

**Colour is not decoration here.** Funnel groups, status, and the benchmark line all carry
meaning. Use `lib/dashboard-theme.ts` tokens; don't introduce a new palette.

**Phase order.** This lands after the CSV import (Phase 6), because a dashboard over
three seeded contacts tells you nothing. Build it against a real imported list.
