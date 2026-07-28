# Network Tracker — Reconciliation to WRN Tracker v3

Put this at `docs/network-tracker/RECONCILIATION.md`. It supersedes the pipeline and
interval sections of BRIEF.md. Everything not mentioned here stands.

**Why:** the WRN Networking Tracker v3 spreadsheet (built 2026-07-23) is the real product
vision. The tracker we specced was written before it existed and diverges on timing,
stages, and several fields. The schema is dev-only and the engine is a pure function with
tests, so this is cheap to change now and expensive later.

**Source of truth:** the spreadsheet, tab for tab. Where this doc and BRIEF.md disagree,
this doc wins.

---

## 1. The three-touch rule replaces the four-touch ladder

The spreadsheet is explicit: three touches is the whole sequence, and a fourth message
costs you the relationship. Our engine sends four.

| | Old (built) | New (spreadsheet) |
|---|---|---|
| Touch 1 | day 0 | day 0 |
| Touch 2 | day 5 | **day 7** |
| Touch 3 | day 12 | **day 12** |
| Touch 4 | day 22 | **none — sequence ends** |

Engine intervals become: `touch_2` at +7d from touch 1, `touch_3` at +5d from touch 2,
then the contact goes dormant (no-answer). `follow_up_1/2/3` is retired as vocabulary —
the product says "touch," so the code should too.

## 2. Stages: 10, not 6

Spreadsheet stages, in order, with the mapping from what's built:

| # | Spreadsheet stage | Value | Was |
|---|---|---|---|
| 1 | Identified | `identified` | `not_contacted` |
| 2 | Intro requested | `intro_requested` | **new** |
| 3 | Sequence active | `sequence_active` | `reached_out` |
| 4 | Replied | `replied` | `responded` |
| 5 | Chat scheduled | `chat_scheduled` | **new** |
| 6 | Chat done | `chat_done` | `meeting_held` |
| 7 | Nurture | `nurture` | `nurture` |
| 8 | Ask made | `ask_made` | **new** |
| 9 | Outcome | `outcome` | `outcome` |
| — | Dormant (no answer) | `dormant_no_answer` | `dormant` (split) |
| — | Dormant (declined) | `dormant_declined` | `dormant` (split) |

`responded_branch` is retired — the declined case is now its own dormant stage, which is
what the spreadsheet's stop rules actually describe.

## 3. Two kinds of dormant

The spreadsheet treats these differently and it's right:

- **No answer after touch 3** → revisit in **35 days** (spreadsheet: 4-6 weeks).
- **They said no or not now** → do not restart for **90 days** (spreadsheet: 3 months).

Reasons: `resurface_no_answer` and `resurface_declined`.

## 4. Revised intervals (authoritative)

| Stage | Next action | Interval |
|---|---|---|
| `identified` | optional poke | 7d, off unless enabled |
| `intro_requested` | chase the mutual | 7d |
| `sequence_active` | touch 2 → touch 3 → stop | +7d, then +5d, then dormant_no_answer |
| `replied` | reply (template S1) | **1d — spreadsheet says same day** |
| `chat_scheduled` | none until the chat happens | null |
| `chat_done` | thank-you (S2) | 1d |
| `nurture` | stay in touch (S3) | **42d recurring (6 weeks, midpoint of 4-8)** |
| `ask_made` | close the loop (S5) | 14d |
| `outcome` | none | null |
| `dormant_no_answer` | resurface | 35d from `dormant_since` |
| `dormant_declined` | resurface | 90d from `dormant_since` |

Reason vocabulary becomes: `touch_2`, `touch_3`, `intro_chase`, `reply`, `thank_you`,
`nurture_recurring`, `ask_followup`, `resurface_no_answer`, `resurface_declined`, `poke`,
`manual`.

**Relationship does not change timing.** All five relationship types run day 0 / 7 / 12 in
the spreadsheet. Relationship picks the *templates*, not the schedule. The engine stays
relationship-blind — keep it that way.

## 5. New contact fields

Added to `network_contacts`:

- `relationship` — `personal` | `affinity` | `referred` | `cold` | `recruiter`. The
  spreadsheet calls this the single most important field: it decides which template
  sequence a contact gets, and getting it wrong is the commonest way a good list produces
  no replies. Required in practice; nullable in the DB for import tolerance.
- `segment` — text. Which target list they came from. Metrics split reply rate by this.
- `priority` — `A` | `B` | `C`. Work order. **Contact-level, distinct from company tier —
  see §6.**

`warm_cold` stays for import provenance only. It drives nothing.

## 6. Two priority systems — resolved by renaming

Companies are kept (the spreadsheet has no company layer, but a dream firm with zero
contacts is real and the spreadsheet can't hold it). That leaves two priority concepts:

- **Company** — how much the client wants to work there. Rename to **`tier`**:
  `dream` | `strong` | `backup`. The column `network_companies.priority` becomes `tier`.
- **Contact** — who to work first. Stays **`priority`**: `A` | `B` | `C`.

One word each, no collision. UI labels: "Tier" on the board, "Priority" on a contact.

## 7. Client Profile — new surface

Spreadsheet tab 2. 16 merge variables plus an elevator pitch, filled in once per client,
consumed by every template:

`CLIENT_FIRST`, `CURRENT_ROLE`, `CURRENT_EMPLOYER`, `SCHOOL`, `GRAD_YEAR`, `DEGREE`,
`TARGET_FIELD`, `TARGET_ROLE`, `TIMEFRAME`, `CITY`, `AFFINITY_1`, `AFFINITY_2`,
`AFFINITY_3`, `KEY_STRENGTH`, `RESUME_LINK`, `CALENDAR_LINK`, plus `elevator_pitch` (text).

New table `network_client_profile`, one row per `client_profile_id`. Client-editable;
coach-editable via the coach layer.

Column note: the `[CURRENT_ROLE]` merge variable is stored in column **`current_role_title`**
— `CURRENT_ROLE` is a reserved word in Postgres, so the column is renamed while the template
token stays `CURRENT_ROLE`. Every other column matches its merge-variable name lowercased.

## 8. Message templates — coach-loaded (RESOLVED)

24 templates: `IN`, `P1-P3`, `A1-A3`, `R1-R3`, `C1-C3`, `X1-X3`, `S1-S5`, `L1-L3`.

Confirmed by the Coach: **SIGNAL generates these, and coaches load them per client through
the coach center.** Per-client content with a coach-facing authoring surface — not a static
library.

**`networking_runs` question — ANSWERED (decision: Option A).**
`POST /api/networking` is SIGNAL's existing per-**job** message generator: profile + a JD →
Claude Haiku (`networking_v9_…`) → 3 "moves" (LinkedIn message / email / opener / queries),
cached to `networking_runs` keyed `(client_profile_id, fingerprint_hash)`; coaches already
load a client's runs via `GET /api/coach/client-runs/[client_profile_id]`.

That is a **different object** from the §8 template library and the two do not merge:

| | `networking_runs` (exists, leave as-is) | `network_templates` (Phase 8, new) |
|---|---|---|
| Keyed by | `(client, fingerprint of a JD)` | `(client_profile_id, template_id)` — `IN`, `S1`, `C2`… |
| Granularity | 3 moves for one job | 24 named reusable templates |
| Content | baked at generation time | `[BRACKET]` merge vars resolved at render time |
| Lifecycle | cache-on-generate, content-hashed | coach-authored/edited, per client |

**Decision:** the per-job generator (`POST /api/networking`) stays as-is and **separate — do
not touch it.** Phase 8 builds `network_templates`, a NEW table keyed on
`(client_profile_id, template_id)`, holding body text with `[BRACKET]` merge variables. Reuse
the generator's **pipeline** (`invokeClaude`, prompt architecture, coach-load surface pattern)
if useful, but not its table or its JD-fingerprint shape.

**The payoff — why the taxonomy is worth it.** The `template_id` is not opaque; it decomposes:

- **Family (letter)** is chosen by the contact's `relationship`:
  `personal → P`, `affinity → A`, `referred → R`, `cold → C`, `recruiter → X`.
  (`IN` = intro request; `S1-S5` = shared/stage replies — thank-you, nurture, ask, etc.;
  `L1-L3` = a separate family, TBD when the spreadsheet's L tab is mapped.)
- **Number** is chosen by the contact's **position in the touch sequence**: touch 1 / 2 / 3
  → `1` / `2` / `3`. A `cold` contact on touch 2 wants template `C2`.

So the engine already knows enough to name the exact template: `relationship` (on the contact)
+ the due `next_due_reason` (`touch_2`, `thank_you`, `ask_followup`, …) map to a `template_id`.
That means the **worklist can say "send C2 to Dana" and render it with merge variables already
resolved** from `network_client_profile` (§7) — no blank-message-staring. This is the join that
makes the tracker + templates + client-profile one product instead of three: pick who's due →
name the template → fill it in. Capture this; do not build it (Phase 8).

### 8.1 "Copy and mark as sent" — the primary action (Phase 8, do not build yet)

When the contact record shows the resolved template (e.g. `C2` with merge variables filled in
from `network_client_profile`), the **primary button is a single action that copies the message
to the clipboard AND logs the corresponding touch in one click.**

**Why it matters.** SIGNAL never sends anything — the user pastes into Gmail or LinkedIn
themselves. So there is always a gap between *composing* and *logging*, and if they forget to
come back and log it, the tracker silently goes wrong: no follow-up gets scheduled, the contact
drops off the worklist, and the reply-rate denominator is understated. One button closes that gap.

**Details to honor when it's built:**
- **The logged action is derived from `next_due_reason`** — `touch_2` due ⇒ the button logs
  `touch_2` (same `REASON_TO_ACTION` mapping the worklist/spreadsheet already use).
- **It counts as pipeline activity**, not a note: it runs `computeNextDue()` (recomputes
  `next_due_at`, advances the sequence) and **consumes any `reminder_override`** — because unlike
  a `note_logged`, this is a real outreach. (The actions route already does exactly this for a
  logged touch; the button is a thin wrapper over it plus the clipboard write.)
- **Keep a plain "Copy only" as a secondary option** — for when someone copies to edit and sends
  later, so we don't log a touch that hasn't actually gone out.
- **Confirm both outcomes visibly** after it fires: "Copied" and "Logged `touch_2`, today" — the
  record must show that the two things happened, or the whole point (closing the compose→log gap)
  is lost to doubt.

## 9. Metrics — SUPERSEDED

**This section is replaced in full by `network-tracker-dashboard.md`** (the two-view design:
Dashboard + Contacts-as-spreadsheet). See that doc for the funnel groups, the
"or beyond" reply/chat definitions, the relationship/segment split, and the phase order
(dashboard lands after CSV import; the spreadsheet view ships first). The three
`first_*_at` milestone columns it needs are added by
`supabase/migrations/20260724_network_first_milestones.sql`.

## 10. Revised phase order

Done and staying done: access gate, six routes, Bearer/`resolveCaller` pattern, the
worklist shape, the create route, the tab strip, the roster.

| Phase | What |
|---|---|
| **R1** | Migration 2: rename `priority`→`tier` on companies; add `relationship`, `segment`, `priority` to contacts; new stage + reason CHECK vocabularies; drop `responded_branch`; new `network_client_profile` table. Dev is disposable — a clean re-drop is fine if simpler than an ALTER. |
| **R2** | Engine rewrite to the three-touch rule + two dormants + revised intervals. Tests rewritten, not patched. |
| **R3** | Update the built UI to the new stages and fields — stepper, roster, add-contact form. |
| **5b** | Companies board (unchanged in shape, `tier` instead of `priority`). |
| **6** | CSV import — now also carries `relationship`, `segment`, `priority`. |
| **7** | Client Profile surface. |
| **8** | Templates, after the `networking_runs` question is answered. |
| **9** | Metrics / dashboard. |
| **10** | Coach layer + heat map. |

R1-R3 come first and land together. The tracker is coherent but wrong until all three ship.

## 11. Two numbers the Coach picked from ranges

Flagged so they're not mistaken for precision:

- Nurture: spreadsheet says 4-8 weeks → **42 days**.
- Dormant no-answer: spreadsheet says 4-6 weeks → **35 days**.

Both are single platform-wide constants in v1, same as every other interval.
