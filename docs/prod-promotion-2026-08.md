# Prod promotion — August 2026

Written 2026-08-09. Every claim about prod below was probed against the live
database on that date, not recalled. **Re-probe before acting**: this document
ages the moment anything is applied.

```
prod  b506edfa9f99e1920712b135ac779a75257c3d72   (2026-08-05, "Fix the monitor's own liveness bug")
dev   cc7226b4                                    origin/dev
gap   140 commits, 2026-07-24 → 2026-08-09
```

**This is not a week. It is a month**, and roughly half of it has never touched
production in any form.

---

## 0. The headline

Promoting `origin/dev` as-is **takes the entire Network Tracker down on prod**,
because none of its tables exist there:

```
network_contacts   MISSING     network_templates       MISSING
network_companies  MISSING     network_comments        MISSING
network_actions    MISSING     network_client_profile  MISSING
```

15 `/api/network/*` routes, 7 `/dashboard/network` pages and 35 source files
read those tables. Every one of them 500s on first request.

Two further tables are missing: `interview_prep_runs` (Prep Now) and
`jobfit_semantic_verdicts`.

---

## 1. Full inventory — what is riding along

140 commits. Grouped by feature area, with the schema each needs and whether
prod has it.

### A. Network Tracker — the largest area, and entirely new to prod

Contacts board, companies board, contact record, stage tracker, action log,
templates, import, worklist, the reminder engine, and this week's ten usability
fixes on top.

| Needs | On prod |
|---|---|
| `network_companies`, `network_contacts`, `network_actions`, `network_comments`, `network_client_profile` | **MISSING** |
| `network_templates` | **MISSING** |
| `client_profiles.network_seeded_at` (seed tracking) | **MISSING** |
| `signal_applications.company_id` (application ↔ company link) | **MISSING** |

**Breaks completely without its migrations.** Not degraded — absent tables
produce PostgREST `PGRST205`, which these routes surface as 500.

### B. Prep Now — new to prod

Interview prep generation, the checklist, the prep page.

| Needs | On prod |
|---|---|
| `interview_prep_runs` table | **MISSING** |
| `signal_interviews.interview_at` | **MISSING** |
| `signal_interviews.interview_format` | **MISSING** |
| `signal_interviews.interviewers` | **MISSING** |
| `signal_interviews.status` / `confidence_level` / `notes` / `thank_you_sent` | exists |

**Breaks on generate and on save.** The prep route reads/writes
`interview_prep_runs`; the job-page interview editor writes `interview_format`
and `interview_at`. Probed individually — the four pre-existing columns are
fine, the three new ones are not.

### C. Interviews tab + status control — this week

Three-group split (Coming up / Waiting to hear / Completed), the dateless fix,
and the inline status control.

| Needs | On prod |
|---|---|
| `signal_interviews.status` | exists |

**Ships safely on its own.** Traced explicitly: the status control sends
`{ status }` only, the tab's type reads no new column, and the list GET is
`select("*")` so missing columns simply do not come back. It is the job-page
*editor* that needs `interview_prep_schema`, not this.

### D. Coach engagements + Proof Project — see §3

Engagement activity CRUD, the sign-off flag, the Proof Project page and its
coach editor.

| Needs | On prod |
|---|---|
| `coach_client_engagements.is_proof_project` | **MISSING** |
| `coach_client_engagement_deliverables.speaking_point`, `why_this_matters` | **MISSING** |
| `coach_client_engagement_activities.is_signoff` | **MISSING** |
| the three `coach_client_engagement*` tables themselves | exist |

**Not cleanly separable — see §3.** The new columns are inside the shared
`ENGAGEMENT_SELECT`, so they break the *existing* coach engagements list, not
just the new surfaces.

### E. Notes re-key — deliberately deferred

| Needs | On prod |
|---|---|
| `coaching_notes.application_id` + nullable `jobfit_run_id` | **MISSING** |

**Shipping the code without the migration breaks notes for everyone**, not just
hand-added jobs: both routes now select and write `application_id`. See §4 —
this is the one item that must not travel with the main deploy.

### F. JobFit engine work — no schema

Verb classifier, JD extraction, run-on splitting, semantic layer tuning,
regression baseline updates. Reads `jobfit_runs`, which exists.

One exception: `jobfit_semantic_verdicts` is **MISSING** on prod. The write is
inside a `try/catch` and logs `console.error` on failure, so it is
**observability, not function** — the trial path keeps working. Worth applying
eventually; not a blocker.

### G. Framer bundle — outside the deploy entirely

`framer/dev/maincomponent.txt` changed (networking prompt, left-nav repoint,
Pass removal). **Not carried by any deploy.** It only reaches users when pasted
into Framer Studio. `framer/prod/maincomponent.txt` is four commits behind dev
and unchanged in this diff.

### H. Docs, tests, seeds — no runtime effect

`docs/network-tracker/*`, `docs/silent-write-failures.md`, the vitest config,
`tests/seed-jordan-dev-board.ts`, `scripts/seed-network-fixture.ts`,
`Regression Testing July 2026/cases`. Ship harmlessly.

---

## 2. Schema gaps, in dependency order

Thirteen migrations. Prod has **none** of them.

| # | Migration | What breaks without it |
|---|---|---|
| 1 | `20260723_network_tracker` | creates the network tables — everything in §A |
| 2 | `20260723_network_tracker_v3_reconcile` | **drops and recreates** them at the v3 shape; without it stage/tier vocab is wrong |
| 3 | `20260724_network_additional_info` | contact record's Additional info field |
| 4 | `20260724_network_first_milestones` | `first_touch_at` / `first_replied_at` / `first_chat_at` — the funnel reads wrong |
| 5 | `20260727_network_note_action_type` | the inert `note` vs pipeline `note_logged` split; without it the Notes drawer write fails the CHECK |
| 6 | `20260728_network_client_profile_seed_tracking` | seed tracking column |
| 7 | `20260728_network_templates` | templates area, and `pickTemplate` on the contact record |
| 8 | `20260730_network_profile_help_dismissed` | networking profile help state |
| 9 | `20260805_application_company_link` | application ↔ company link; `NetworkAtCompany`, the tracker contact badge, company card applications |
| 10 | `20260805_interview_prep_schema` | Prep Now entirely, **and** saving format/time on the job page |
| 11 | `20260808_proof_project` | see §3 — breaks the coach engagements LIST |
| 12 | `20260808_engagement_activity_editing` | see §3 — same |
| 13 | `20260809_coaching_notes_application_key` | every note read and write on prod — **moved into step 1**, see §4 |

### ⚠️ Migration 2 is a live footgun

`20260723_network_tracker_v3_reconcile.sql` opens with:

```sql
DROP TABLE IF EXISTS public.network_comments        CASCADE;
DROP TABLE IF EXISTS public.network_actions         CASCADE;
DROP TABLE IF EXISTS public.network_contacts        CASCADE;
DROP TABLE IF EXISTS public.network_companies       CASCADE;
DROP TABLE IF EXISTS public.network_client_profile  CASCADE;
```

Its header says *"dev is disposable and there is no data to preserve"*. That is
true of prod **today** — the tables do not exist. It will not be true the day
after this ships.

It is self-contained: it creates its own `network_set_updated_at()` function and
every table, index, trigger and RLS policy it needs. It depends on migration 1
for nothing.

**Two consequences.** Running 1 then 2 creates tables and immediately drops
them — harmless, wasteful. And this file must never be re-run against prod once
real networking data exists: it would silently destroy every contact, company,
action and note on the board.

**RESOLVED 2026-08-09 — a guard now sits ahead of the DROPs.** It counts rows in
all five `network_*` tables and raises rather than proceeding if any are
non-empty. The misleading "dev is disposable and there is no data to preserve"
header has been rewritten, since that sentence was the most likely thing to talk
someone into running it. A deliberate wipe is still possible but has to be asked
for explicitly, in the same session:

```sql
SET network_reconcile.allow_destructive = 'i_have_a_backup';
```

All four branches were tested before this was trusted:

| Branch | Where | Result |
|---|---|---|
| tables non-empty | dev (real board) | refused, listed 192 rows, exit 3 — halts before the DROPs under `ON_ERROR_STOP` |
| present but empty | dev, in a rolled-back transaction | passed with a NOTICE; dev intact afterwards |
| tables absent (prod's state) | `to_regclass` on a missing relation | returns NULL, skipped cleanly |
| override set | dev | proceeds with a WARNING |

Note the guard protects against *re-running*. It cannot protect against running
it once, in order, as intended — which is exactly what step 1 does, and is
correct only because prod's tables are empty today.

---

## 3. The Proof Project decision — **ship the migrations, do not cut the code**

**It is not cleanly separable.** The new columns are inside the shared selects
in `app/api/_lib/coachEngagements.ts`:

```
ENGAGEMENT_SELECT        …, proposal_status, is_proof_project, attached_at, …
ENG_DELIVERABLE_SELECT   …, fee_cents, speaking_point, why_this_matters, …
ENG_ACTIVITY_SELECT      …, due_date, is_signoff, sort_order, created_at
```

Those selects are used by **five routes**, including the pre-existing
`GET /api/coach/coach-clients/[id]/engagements`. Cutting the migrations while
shipping the code means **any coach opening any client's engagements gets a
`42703` on `is_proof_project`** — a feature that works on prod today, broken by
migrations we deliberately withheld.

**What cutting the code would cost.** Reverting the select changes, the two
route files that read the new fields, the coach editor UI, `lib/proofProject.ts`
and its tests, plus the client page and `/api/me/proof-project`. That is surgery
across ~10 files on a branch with 140 commits, done under time pressure, to
avoid two `ALTER TABLE … ADD COLUMN` statements that default to the inert value.

**DECIDED 2026-08-09: apply migrations 11 and 12, keep the code.** They are additive, default-off
(`is_proof_project` defaults false, the prose fields are nullable), and read by
nothing prod users can reach — the Proof Project page renders "No proof project
yet" when no engagement is flagged, and the hub banner renders nothing at all on
any failure. The cost of shipping them is two inert columns. The cost of not
shipping them is either a broken coach feature or risky last-minute surgery.

**This is a reversal of the earlier "cut them" decision, and the reason is new
information**: the columns had leaked into a shared read path, which was not
known when that call was made.

---

## 4. Ordering

### Step 1 — Migrations 1→13, in file order, on prod

One transaction each, `ON_ERROR_STOP=1`. Migrations 1 and 2 must run adjacent
and in order.

**Migration 13 is included deliberately.** It was previously going to be held
back for a later day, which does not work: the route code that reads and writes
`coaching_notes.application_id` is already on `origin/dev` and travels with the
step 2 deploy whether or not the migration ran. Holding the migration back while
shipping the code breaks every note read and write on prod. The original
concern — schema must land before code — is satisfied by putting it here, since
step 1 precedes step 2 by construction.

Verify after: every table in §0 exists; `signal_applications.company_id`,
`signal_interviews.interview_at/format/interviewers`,
`coach_client_engagements.is_proof_project`,
`coach_client_engagement_activities.is_signoff` all present.

### Step 2 — Deploy the code

`vercel promote` from a dev Preview, per the established flow. All 140 commits.

**Nothing here is deploy-ordered against Step 1 in the other direction** — the
schema is additive, so it can sit ahead of the code indefinitely. The reverse is
not true: code before schema is the outage.

### Step 3 — Paste the Framer bundle into Framer Studio **prod**

`framer/prod/maincomponent.txt` was rebuilt 2026-08-09 and is ready. Gated on
step 2 landing first: the left-nav points at `/dashboard/network/companies`,
which does not exist until the code deploys.

**DO NOT copy `framer/dev/maincomponent.txt` over it.** That was the original
instruction here and it was wrong. Dev's copy carries ~1,300 lines of paused
Positioning v2 / Stage 1c work that has never been in prod, five staging URLs,
the dev Supabase project *and its anon key*, and a `DEV_MODE`/`DevBanner` block.
A straight copy ships all of it.

What was actually done: the net of the four networking commits
(`e4b3ce3b..aba1c128`, +247/−3) applied onto **prod's** base. Nine of eleven
hunks applied cleanly; two were hand-placed after a fuzzy match silently
inserted a `useState` block *inside* an unrelated `if` body — a change that
parses as nonsense and would have broken the component. `e4b3ce3b` was excluded
deliberately: its payload is a feedback link hardcoded to staging.

Verified on the built file: 0 staging references, 0 dev-Supabase references, 0
`DEV_MODE`/`DevBanner`, 0 Positioning v2 symbols; all four constants and the
anon key on the prod project (`ejhnokcnahauvrcbcmic`); 0 syntax errors from the
TypeScript parser; and the feature's three symbols each defined once and called
once, in the same enclosing function as in dev.

### Step 4 — Verify the notes re-key on prod

The migration ran in step 1 and the routes went out in step 2, so this is a
check rather than a deploy:

1. `coaching_notes.application_id` exists and `jobfit_run_id` is nullable.
2. A note saves and reads back on a **hand-added** job (no `jobfit_run_id`) —
   this is the case that was impossible before.
3. Coach-private notes still do not surface to the client.

**Do not validate the backfill by its row count.** Prod has 2 notes and both are
orphans, so a correct run updates zero rows — indistinguishable from a broken
one. See §6.

---

## 5. Rollback

| Step | Reversible? | How |
|---|---|---|
| Migrations 1, 3–8 (network tracker) | **Yes, trivially** — prod has no data in these tables. `DROP TABLE … CASCADE` restores the status quo exactly. |
| Migration 2 (v3 reconcile) | **Yes today, never again.** It drops and recreates. Once prod has networking data, re-running it destroys that data and rolling it back destroys it too. The guard added 2026-08-09 now refuses the re-run case; it does not make the migration reversible. |
| Migration 9 (`company_id`) | **Yes.** `ALTER TABLE signal_applications DROP COLUMN company_id`. Loses the links but nothing else. |
| Migration 10 (prep schema) | **Partly.** Dropping the three columns is clean. `DROP TABLE interview_prep_runs` destroys generated prep — none exists on prod today, so today it is clean. |
| Migrations 11, 12 (Proof Project) | **Yes.** Additive columns + one index + one backfill of a boolean. Drop the columns and the index. 12's backfill only sets `is_signoff`, which goes with the column. |
| Migration 13 (notes re-key) | **NO, not fully.** The `DROP NOT NULL` on `jobfit_run_id` is reversible only if no row has been written with a null run — i.e. only until the first note on a hand-added job. After that, restoring `NOT NULL` requires deleting those notes. |
| Step 2 (code deploy) | **Yes.** Vercel deploy history, promote the previous build. Standard rollback. |
| Step 3 (Framer paste) | **Yes.** Framer keeps published versions; re-paste the previous bundle. Slow but complete. |

**The asymmetry to hold onto:** the schema is easy to undo *while prod has no
data in it*. That window closes the moment the first user touches the networking
area. Rollback planning after that point is a different exercise.

---

## 6. What cannot be tested beforehand

**Prod has no networking data at all — not a small amount, none.** There is
nothing to regress against, so the following are only knowable by doing:

1. **Whether the migration set applies cleanly in sequence on prod.** It has
   only ever been run on dev, where the tables were built incrementally over
   three weeks. Prod runs 13 migrations against a schema that has never seen
   any of them. Migration 2's drop-and-recreate in particular has never executed
   in an order where migration 1 ran minutes earlier.

2. ~~**RLS behaviour with real auth.**~~ **Withdrawn — this was wrong, and the
   correction matters.** The network tables do carry owner-only policies keyed
   on `auth.uid()`, and they have indeed never been exercised by a logged-in
   user. But that is not a gap waiting to be closed: **RLS never fires at all**.
   All 14 data-touching network routes reach Supabase through
   `getSupabaseAdmin()` (service role), which bypasses RLS by design, and
   nothing else touches these tables — no anon key anywhere in `app/dashboard/`,
   no direct PostgREST access. The policies are inert.

   The real boundary is route code: `getAuthedUser` (verifies the bearer token
   via `supabase.auth.getUser`, not a bare decode) → `resolveCaller` → then
   either `assertBoardAccess` on 7 board routes or a fetch-then-compare
   `client_profile_id !== profileId → 403` on the 8 routes that take an object
   id from the URL.

   **That boundary has now been tested — see §6a.** Two latent traps remain:
   `network_templates` has RLS enabled with **no policy at all** (harmless while
   the service role is used, fails closed if anything ever switches), and the
   inert policies invite the belief that the database is enforcing tenancy when
   it is not.

3. **The reminder engine against real timestamps.** Every due date on dev came
   from a seed that replayed the engine with backdated instants. Prod's first
   contacts will be created live, with `created_at = now()` and no history —
   a code path the seed never produces.

4. **Performance of the contacts board at real scale.** Dev's largest board is
   nine contacts. `sortForAttention` re-ranks client-side on every load, and the
   band grouping walks the list twice. Fine at nine. Unknown at several hundred.

5. **Prep Now's first real generation on prod.** `interview_prep_runs` will be
   empty and the LLM path has never run against prod's env vars.

6. **Whether the Framer prod bundle's `API_BASE` is correct** until it is pasted
   and a scan is run. The dev copy points at staging.

7. **The notes re-key backfill on prod.** Dev backfilled 6 of 6. Prod has 2
   notes and **both are orphans** — so the backfill will update **zero rows**
   there. It cannot be validated by its own success on prod: a correct run and a
   silently broken one both report `UPDATE 0`. Validate by asserting the column
   exists and that new notes on hand-added jobs read back, not by the count.

8. **Coach ↔ client flows end to end.** Prod has real coaches and real clients;
   dev's are fixtures. Sharing, visibility and the coach-private wall have never
   been exercised with two genuinely different accounts on prod.

**The honest summary:** this promotion moves a feature area from "works on a
nine-row fixture board" to "carries real users", and the gap between those is
mostly untested by construction. Nothing above argues against shipping. It
argues for shipping when someone can watch it.

---

## 6a. Cross-account authorization test — PASSED (2026-08-09)

`tests/network-authz-ab.ts`. Two real accounts on dev, real sessions minted via
`generateLink` + `verifyOtp` (no password changes), user A attempting to reach
user B's board through the running API. Neither account is a coach and no
`coach_clients` link exists between them — the test aborts if one does, since a
coach link would make cross-board reads legitimate.

```
A = erin+test@workforcereadynow.com       (12 contacts)
B = peri+demojordan@workforcereadynow.com (10 contacts)
29 passed, 0 failed
```

| Group | Result |
|---|---|
| Control — A uses its own board | 200, non-empty (so the test has teeth) |
| No token / garbage token | 401 |
| A reads B's contacts, companies, worklist, templates, profile, single contact | **403** on all six; B's contact name does not leak into the refusal body |
| A writes to B: PATCH/DELETE contact, POST action/stage/reminder, PATCH/DELETE company, PATCH profile, PATCH/DELETE template | **403** on all ten |
| Post-state | B's contact, company, names, stage and contact count all unchanged; no action authored by A on B's contact |

**Why this is the right test and an RLS test would not have been:** the routes
use the service role, so RLS is never consulted. This exercises the code that is
actually load-bearing. Run against dev, but the same route code and the same
policy DDL ship to prod, so the result carries.

**One route behaves differently and it is worth knowing.**
`POST /api/network/contacts/delete` is *scoped*, not *gated*: it filters on
`client_profile_id = caller`, so a request carrying another board's ids matches
nothing and returns **200 with zero rows deleted** rather than 403. Not a
vulnerability — the data survives, which the test asserts directly — but it
means a 200 from that endpoint is not evidence that anything was deleted.

### A real inconsistency this surfaced

Writing the test caught it out twice, in a way worth fixing:

- `PATCH /api/network/profile` takes `client_profile_id` from the **body**.
- `PATCH /api/network/templates/[id]` takes it from the **body**.
- `DELETE /api/network/templates/[id]` takes it from the **query string** —
  same route file as the PATCH above.

Send it in the wrong place and the route silently falls back to *the caller's
own id*, does the write against the caller's own data, and returns 200. That is
fail-safe, so it is not a security hole. But it is indistinguishable from a
successful cross-tenant write unless you check which row actually changed, and
it cost two false results here before it was spotted. A coach UI that passed the
target in the wrong place would silently edit the coach's own profile instead of
the client's. Worth normalising on one convention.

### Cost of running it

The first run wrote `"PWNED"` into A's *own* `elevator_pitch` (the query-string
fallback above) before the test snapshotted it. That value is unrecoverable; it
was almost certainly null, and has been set back to null. The second run created
a template override row for A, which was deleted — `created_at` confirmed the
row was created by the test, so removing it restored the exact prior state. A
residue check across templates, profiles, contacts and companies returns zero.
The test now snapshots the caller's own row and asserts it is unchanged, so this
cannot recur silently.

### Still untested

The **coach** path. `assertBoardAccess` grants cross-board access at
`view`/`annotate`/`full` to a coach with an active `coach_clients` link, and
none of the accounts used here is a coach. Whether the access *levels* are
enforced correctly — that an `annotate` coach cannot do a `full` action — is not
covered by this run.
