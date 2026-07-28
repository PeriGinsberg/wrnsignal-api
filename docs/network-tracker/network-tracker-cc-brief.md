# Network Tracker — BRIEF (state of play)

**Read this first.** It's the cold-start index for the Network Tracker: where every phase
stands, which docs to trust, the decisions that are locked and *why*, what's still open, and
how to run the thing. Assume no memory of the build — everything you need to resume is here or
pointed at from here.

**What the Network Tracker is.** A networking CRM inside SIGNAL (`app/dashboard/network`).
Users track people they're reaching out to through a pipeline; the app tells them who's due to
contact today. Owner = a `client_profiles` row (the "client"). Coached clients also get coach
visibility later (the Coach Layer, unbuilt). Not to be confused with `/dashboard/tracker` (the
job-application tracker) or `networking_runs` / `POST /api/networking` (an *existing, separate*
AI message generator — see §3).

---

## 1. Where things stand

Status legend: **✅ done & verified** (green in the smoke / unit tests) · **🔶 built, not wired**
(code exists, not surfaced to users) · **📋 specced, not built**.

| Phase | What | Status |
|---|---|---|
| 0 — Recon | Stack decisions (§7) | ✅ |
| 1 — Schema + engine | `lib/network-tracker/reminder-engine.ts` (`computeNextDue`, pure) + 25 unit tests | ✅ done & verified |
| 2 — Spine | `lib/network-tracker/access.ts` + 6 routes (`worklist`, `companies` GET, `contacts` GET/POST, `contacts/[id]` GET/PATCH/DELETE, `.../actions`, `.../stage`, `.../reminder`) | ✅ verified by `spine-smoke.ts` |
| 3 — Worklist (the Dashboard tab) | `app/dashboard/network/page.tsx` + `WorklistRow.tsx` + tab-strip `layout.tsx` | ✅ built · ✅ **in the dashboard nav** (`2f69ae50`) |
| 4 — Contact record | `contacts/[contactId]/page.tsx` + `PipelineStepper.tsx` (7-segment phase bar + 11-stage dropdown, `e014af84`) + `ActionLog.tsx` + `NotesLog.tsx`; running notes, "About this person", additional-info, details, snooze, delete | ✅ |
| 4.5 — Add contact | `POST /api/network/contacts` + `AddContactForm.tsx` | ✅ |
| 5a — Contacts spreadsheet | `contacts/page.tsx` — dense table, filters, inline log/stage, bulk-select + delete | ✅ (replaced the old roster) |
| 5b — Company board | `companies/page.tsx` grouped by `tier`, expandable company cards with lazy-loaded contacts, `POST`/`PATCH`/`DELETE` company routes, zero-contact wishlist firms | ✅ built (`9671d02e`) |
| 6 — CSV/XLSX import | `import/preview` + `import/commit` routes + `import/page.tsx` wizard; `read-excel-file` + `papaparse` | ✅ verified (CSV smoke + `import-parse.test.ts`) |
| 7 — Delete | single `DELETE /contacts/[id]` + batch `POST /contacts/delete` + record & spreadsheet UI | ✅ verified |
| 7a — Profile source map | Traced which of the 16 merge vars SIGNAL already stores, and where | ✅ done (see §3 seed rules) |
| 7b — Client Profile | `profile/page.tsx` + `GET/PATCH /api/network/profile` + `lib/network-tracker/client-profile-seed.ts`; seeded from client_profiles, auto-fills blanks, X-of-17 completeness meter | ✅ built |
| 8 — Templates | 24 defaults in `lib/network-tracker/template-defaults.ts` + `network_templates` overrides (8a); `renderTemplate` (8b); `pickTemplate` contact→template join (8c); `SendPanel` copy-and-mark-as-sent (8d) | ✅ built (`ef378e1a`…`6ba0a1c8`) |
| 9 — Dashboard (metrics under the worklist) | 7-group funnel, reply/chat rates, what's-working splits, needs-attention — all client-side in `dashboardMetrics.ts`, every group and row deep-linking into filtered Contacts | ✅ built |
| 10 — Coach layer + heat map | universal coach comments, coach view/edit | 📋 specced |

**The tracker is FEATURE-COMPLETE except Phase 10, and LIVE in the dashboard nav (dev).** Phases 0–9 are built; the coach layer is the only phase left, and prod has none of the schema yet (§4). It is no longer URL-only. `D2C_NAV` in
`app/dashboard/layout.tsx` carries a **Networking** entry beside My Account and Job Tracker
(`matchPrefix`, so it stays highlighted across all three sub-tabs), added in `2f69ae50`. Real
clients on dev can reach it, use it, and put their own data in.

What unblocked it: the Companies tab used to render but 404, so surfacing the tracker would have
shipped a visibly broken tab. Phase 5b closed that (`9671d02e`). All three views resolve, the two
ways in both work from a cold account — the **Add-a-contact form** (`POST /api/network/contacts`)
and the **import wizard** (`POST /api/network/import/commit`), the only two writers to
`network_contacts` — and the three empty states are pinned by
`app/dashboard/network/emptyStates.test.tsx`, which renders the real pages against empty payloads
and fails if one ever degrades into something error-shaped.

> ### ⚠️ LIVE BUT INCOMPLETE — read this before assuming a gap is a bug
>
> **The loop is complete.** A user can run the whole thing today: import or add contacts, work
> the daily worklist, open a due contact and find the right template already filled in with their
> profile and the contact's details, copy it and mark it sent in one action (which advances the
> pipeline), log notes and touches, move stages, manage the company board, and read the dashboard
> for what is working.
>
> **Phase 10 (coach layer) is the only unbuilt phase**, and prod promotion is the only unfinished
> operational step. Everything below is a deliberate carve-out, **by plan, not by defect**:
>
> - **Phase 7b — Client Profile.** BUILT. Two of the 17 fields have no honest source and start
>   blank by design: `city` (the only stored location is where the client wants to WORK, which
>   would be wrong-but-plausible in a box meaning where they ARE) and `degree`
>   (`education_status` is only in_school/graduated/na). `affinity_1..3`, `calendar_link` and
>   `elevator_pitch` are genuinely new and always client-entered.
> - **Phase 8 — Templates.** BUILT. Two of the 24 are never auto-suggested by design: S1
>   (scheduling) and S5 (post-referral thanks) correspond to no due reason the engine raises, so
>   `pickTemplate` returns null and the user picks them from the full list. Fill-at-send prompts
>   (`[MUTUAL]`, `[ONE SPECIFIC QUESTION]`, `[OPTION 1..3]`) are deliberately left in the rendered
>   text as the writer's instruction — they warn before copy but never block it.
> - **Phase 9 — Dashboard.** BUILT. Two carve-outs remain, both because the dashboard does not
>   fetch `network_actions`: "follow-ups completed this week" is deferred (the weekly bar counts
>   first touches only, so a week spent entirely on follow-ups reads as zero effort), and the
>   benchmark line gates on `reached >= 10` rather than on contacts who finished all three
>   touches. Both are the first things an aggregate route would buy back. See DASHBOARD Part 1.
> - **Phase 10 — Coach layer.** Coach comments and coach view/edit are specced and unbuilt. Note
>   the locked decision in §3: coaches can *never* mutate the PIPELINE — stage, actions,
>   reminders, contact edits and deletes are owner-only and return 403 for a coach. The two
>   exceptions are the outbound copy built in Phases 7b and 8a (the networking profile and the
>   template overrides), which a coach IS meant to help write. So the coach layer proper is
>   view/annotate over the pipeline, and that is a deliberate constraint rather than an
>   unimplemented feature.
>
> Also still true: **prod has none of this schema.** Seven migrations now, all dev-only — the four
> in §4 plus `20260727_network_note_action_type`, `20260728_network_client_profile_seed_tracking`
> and `20260728_network_templates`. Live means live *on dev*, and prod promotion stays a separate,
> human-reviewed step.

---

## 2. The docs, and which supersedes which

A cold reader must know which file to trust when they disagree. Precedence, highest first:

1. **`network-tracker-reconciliation.md`** — the WRN Tracker v3 reconciliation. **Overrides
   BRIEF's pipeline/stage/interval content and RECONCILIATION §9 is itself overridden by
   DASHBOARD.** This is the source of truth for stages (11 of them), the three-touch rule,
   intervals, the two dormants, the `relationship`/`segment`/`priority` fields, the
   `tier` rename, `network_client_profile`, and the Phase 8 template design (§8, §8.1).
2. **`network-tracker-dashboard.md`** — replaces RECONCILIATION §9 (metrics). The two-view
   design: Dashboard (Part 1, built) + Contacts-as-spreadsheet (Part 2, built).
3. **`network-tracker-import.md`** — **overrides `data-model.md`'s import-mapping section.** The
   upload → guess → preview → confirm import. Header detection, synonym mapping, name-splitting,
   non-person rows, email-isn't-unique, deliberately-blank fields, the parser decision.
4. **`network-tracker-data-model.md`** — current schema reference (v3), the reminder-interval
   constant, the worklist query. Its *import-mapping* section is superseded by IMPORT (and says
   so); everything else is live.
5. **`network-tracker-cc-brief.md`** (this file) — state of play + locked decisions. Its old
   pipeline/interval/import prose is **superseded by RECONCILIATION and IMPORT** — trust those
   for the rules; trust this for status, precedence, decisions-with-reasons, and how-to-run.
6. **`network-tracker-pages.md`** — the original Phase-0 page/route sketch. Historical; the real
   routes/pages have moved past it. Low authority.

Code that is itself a source of truth: `lib/network-tracker/reminder-engine.ts` (interval math,
one place), `supabase/migrations/2026072*_network_*.sql` (schema), `lib/network-tracker/*.ts`.

---

## 3. Locked decisions — with the reasons (the reasons are what stop someone undoing them)

- **`next_due_at` is STORED, not computed on read.** Reason: the daily worklist must be one
  indexed scan on `(client_profile_id, next_due_at)`. Computing due-dates per read would mean
  recomputing the engine for every contact on every worklist load, and couldn't be indexed.
  Every write recomputes it once via `computeNextDue()` and saves the result.
- **`computeNextDue()` lives in ONE file and is called in ONE place per write.** Reason: due-date
  drift is the classic CRM bug. If two code paths compute intervals, they diverge. The routes
  call the engine and save; nothing else does interval math. Never inline "+7 days" in a route or
  component.
- **Pipeline activity CONSUMES `reminder_override`.** Logging an action or changing stage clears a
  snooze and folds the contact back onto its stage cadence. Reason: an override is "remind me on
  this date." If it survived a real touch, a contact snoozed to a past date would be *permanently
  overdue* — stuck on the worklist forever, un-workable. The engine takes `pipelineActivity` and
  returns `clearOverride`; the actions and stage routes null the column. The reminder route does
  NOT pass it (that's where the override is *set*).
- **Coaches cannot mutate the PIPELINE — but the OUTBOUND COPY is coach-writable, on
  purpose.** These sit next to each other deliberately, because read together they look like a
  contradiction and are not. The pipeline (stage, actions, reminders, contact edits, deletes) is
  the client's own work record: a coach editing it would corrupt the client's due-dates and
  history, so every one of those routes is owner-only and returns 403 for a coach.
  TWO surfaces are a different kind of thing, and both carve out the same exception:
  `network_client_profile` (the 16 merge variables + elevator pitch, Phase 7b) and
  `network_templates` (per-client overrides of the 24 outreach templates, Phase 8a). Both are
  shared outreach copy a coach is expected to help write, so `/api/network/profile` PATCH and
  `/api/network/templates/[templateId]` PATCH/DELETE gate on `assertBoardAccess(..., "full")`
  — client and coach may both edit, last save wins, and `edited_by` records which. The test is
  *whose record is it*: the pipeline records what the client DID and only they may change it;
  the profile and the templates are what gets SENT, and the coach helps draft it. Note there is
  no `"edit"` access level — the levels are `view | annotate | full`.

  The owner-only routes this covers, concretely: contact create, stage, actions, reminder,
  contact PATCH, and both deletes — all gated `client_profile_id === caller`, 403 for a coach.
- **`cycle_started_at` exists.** Stamped on any transition INTO `sequence_active`. The engine
  counts only touches with `action_date >= cycle_started_at`. Reason: without it, re-engaging a
  contact that went dormant after touch 3 would re-count the *old* cycle's touches and flip it
  straight back to dormant — you could never work someone a second time. NULL = count all (first
  cycle / never re-engaged).
- **Dedup is case-insensitive EXPRESSION indexes, not table `UNIQUE`s.** Three partial unique
  indexes on `lower(...)`. Reason: a table-level `UNIQUE` can't hold `lower()`, and "GBQ"/"gbq"
  or "Dana"/"dana" are the same entity. Contacts split into two indexes (company-attached vs
  standalone) because Postgres treats NULLs as distinct, so one index over `company_id` would
  never fire for standalone contacts. **Import must `onConflict` on the index *names*** — there's
  no constraint to fall back on.
- **Stage/reason labels are UI-only (`STAGE_LABELS`/`REASON_LABELS` in `vocab.ts`).** The DB stores
  machine values (`sequence_active`, `touch_2`); the UI shows "Message sent", "Send follow-up".
  Reason: a wording change should never be a migration. Every surface reads from the shared map;
  never hardcode a stage's display text.
- **Company delete → contacts become standalone (`ON DELETE SET NULL`).** Reason: deleting a target
  *firm* shouldn't vaporize the *people* you know there — they survive as standalone contacts,
  re-attachable elsewhere. **When Phase 5b builds company delete, its confirmation MUST say the
  contacts become standalone.** (Not reachable in the UI today — no company-delete route exists.)
- **Contact delete is HARD, not a soft-delete flag.** `network_actions` + `network_comments`
  cascade. Reason: a soft-deleted state would have to be excluded from every query forever — a
  permanent tax on all future code. Cascade means no orphans.
- **Bulk "select all" = the currently-FILTERED set, scoped to visible rows.** Selection is
  intersected with the filtered rows, so you can only ever delete what you can see. Reason: the
  footgun is selecting 48 filtered import rows, then the filter changing, and deleting 300. The
  confirmation names who's going (≤4: all; >4: first three + "and N others").
- **XLSX parser is `read-excel-file`, not exceljs or SheetJS.** Reason: exceljs *failed on the
  first real file* (namespace-prefixed workbook — the ChatGPT/tool-generated class the import
  targets) and patching one gap revealed the next; SheetJS's fixed build is CDN-only (breaks
  Vercel clean install) and its npm build carries CVEs. `read-excel-file` is npm/MIT/maintained
  and read the real file cleanly. See IMPORT §1.
- **`networking_runs` / `POST /api/networking` is a SEPARATE existing feature — do not touch it.**
  It's SIGNAL's per-*job* AI message generator (Claude Haiku → 3 "moves", cached by JD
  fingerprint), which coaches already load per client via `GET /api/coach/client-runs`. Phase 8's
  template library is a *different* object (per-client, keyed `(client, template_id)`, merge-var
  templates); it reuses the generation *pipeline*, not that table. RECONCILIATION §8 has the full
  answer.

---

## 4. Outstanding items

- **Prod promotion — nothing is in prod.** All schema is DEV-only (`zydrqckpwidipwbhrfgd`). SEVEN
  migration files exist; prod has none. The first four:
  1. `20260723_network_tracker.sql` (v1)
  2. `20260723_network_tracker_v3_reconcile.sql` (v3 — a **clean re-drop**, recreates everything)
  3. `20260724_network_first_milestones.sql` (adds `first_touch_at`/`first_replied_at`/`first_chat_at`)
  4. `20260724_network_additional_info.sql` (adds `additional_info`)

  Then, added during Phases 7–8: `20260727_network_note_action_type.sql`,
  `20260728_network_client_profile_seed_tracking.sql`, `20260728_network_templates.sql`.

  For prod, the effective path is **v3_reconcile → first_milestones → additional_info → the three
  Phase 7–8 migrations in filename order** (v1 is
  superseded by the v3 re-drop; running all four in filename order also works — v3 just drops and
  recreates v1's tables). Apply in the Supabase SQL Editor, **then run the schema-reload NOTIFY
  (§5)**. Prod promotion is a separate, human-reviewed step — never auto-applied.
- **Two parser fixtures are missing.** `network-import-fixtures/` (git-ignored, holds real client
  data) has `maleri.xlsx` (a tool-generated, namespace-prefixed workbook — the hard case). Still
  needed: **a Google-Sheets export and an Excel-saved .xlsx.** I can't fabricate these — their
  value is the writer-specific quirks of those exact apps, and a file I write myself would just
  test the library against my own writer. Someone must export one from Google Sheets and save one
  from Excel, drop both in `network-import-fixtures/`, and `import-parse.test.ts` auto-covers them
  (it iterates the dir, skips when absent). "This file class is the target, so one passing file
  isn't proof."
- ~~The tracker is URL-only, blocked on Phase 5b~~ — RESOLVED: 5b shipped (`9671d02e`) and the
  tracker is in the dashboard nav (`2f69ae50`). See §1.
- **`node_modules` is tracked in git and shouldn't be.** 22,377 files are in the index even
  though `node_modules/` is listed in `.gitignore` line 7 — they were committed before that rule
  existed, and git keeps tracking what's already indexed. It was never deliberate vendoring: the
  files arrived incidentally inside two unrelated March 2026 commits (`c11f580c` 1,299 files,
  `406873e7` 82 files), and the snapshot is partial and stale (291 of 479 top-level packages,
  with ~90 tracked files already deleted on disk). Every real dependency commit in this repo's
  history — `4047cdee`, `8f8f62ab`, `ae4db00f`, `026e2f53`, `735d0148`, `602777d0`, `8995f92b` —
  commits `package.json` + `package-lock.json` only, which is the correct pattern and the one to
  keep following. Vercel installs from the lockfile and never reads the vendored copy.
  **Cleanup:** `git rm -r --cached node_modules` as a **standalone ~22k-file commit at a quiet
  moment** — never mixed with feature work. Benefit: `git status` stops being ~150 lines of
  vendor noise and vendored diffs stop leaking into feature commits (it has happened twice).

---

## 5. How to run things

**Environment.** Scripts read creds from the shell (never `.env*`). Export before running:
```
SUPABASE_URL           = https://zydrqckpwidipwbhrfgd.supabase.co   (or NEXT_PUBLIC_SUPABASE_URL — both accepted)
SUPABASE_SERVICE_ROLE_KEY = <dev service-role key>
```
On this machine, tsx scripts hitting Supabase need `NODE_OPTIONS=--use-system-ca`. In Claude
Code, run these with a leading `!` so they execute in *your* shell (the tool's shell doesn't
inherit your exports).

**⚠️ After ANY migration, reload the PostgREST schema cache** — or the API keeps 400/500-ing on
the new columns as if they don't exist. This has bitten us twice. In the Supabase SQL Editor:
```sql
NOTIFY pgrst, 'reload schema';
```

**End-to-end smoke** (mints a throwaway user, drives every route through `resolveCaller`, cleans
up in `finally`). Requires migrations 3 + 4 applied:
```
! $env:NODE_OPTIONS="--use-system-ca"; npx tsx tests/network-tracker/spine-smoke.ts
```

**Unit tests** (no DB/env needed):
```
npx tsx --test tests/network-tracker/reminder-engine.test.ts tests/network-tracker/parse-name.test.ts tests/network-tracker/import-parse.test.ts
```
(`import-parse.test.ts` also parses whatever real files sit in `network-import-fixtures/`,
skipping cleanly when the dir is empty.)

**Seed / reset dev fixture** (17 varied contacts, 5 companies + 3 standalone, mixed stages/status;
`--email` is the board owner, `--confirm` required to write; `--clean` removes only fixture rows):
```
! $env:NODE_OPTIONS="--use-system-ca"; npx tsx scripts/seed-network-fixture.ts --email=peri@workforcereadynow.com --confirm
! $env:NODE_OPTIONS="--use-system-ca"; npx tsx scripts/seed-network-fixture.ts --email=peri@workforcereadynow.com --clean --confirm
```
Both refuse to run against the prod project ref.

**See the UI.** `npm run dev` in a separate terminal (long-running — not through `!`), sign in as
the seeded owner, open `http://localhost:3000/dashboard/network`. The local dev server must point
at DEV Supabase or the seeded rows won't show.

---

## 6. The next obvious step when work resumes

**Build Phase 5b (the company board).** It's the highest-leverage unblock: it kills the 404
Companies tab, which is the thing keeping the whole tracker out of the dashboard nav. Once 5b
ships, the tracker can be surfaced to users and the rest (import cleanup flows, the dashboard,
templates) has a real home. 5b is well-specced (RECONCILIATION §6 for `tier`; the board is
"companies grouped by tier, a side-drawer for edits, zero-contact wishlist firms supported"),
needs company create/`PATCH` routes (the `matchOrCreateCompany` helper already exists), and its
delete confirmation must say contacts become standalone (§3).

If prod is the priority instead: promote the four migrations (§4) + the schema-reload NOTIFY (§5),
smoke against a prod-pointed throwaway, then decide on nav surfacing.

---

## 7. Stack & conventions (LOCKED — still true)

- **DB:** Postgres 17 on Supabase. Access via `@supabase/supabase-js`. **No ORM.** Schema = raw
  SQL in `supabase/migrations/*.sql`. Enums = `TEXT` + `CHECK`. PK = `uuid DEFAULT gen_random_uuid()`.
- **Auth:** client components get a Supabase session token, call `app/api/**/route.ts` with
  `Authorization: Bearer <token>`; the route resolves the user via **`resolveCaller(req)`**
  (`lib/collab/identity.ts`) → `{ profileId, isCoach }`. **No server actions, no cookie SSR.**
- **Owner key:** `client_profile_id` → `client_profiles(id)`. `author_role` uses `client` (never "student").
- **Coach access:** `coach_clients` + `verifyCoachAccess` (`lib/collab/access.ts`) — never a new mechanism.
- **RLS** on every tracker table (belt-and-suspenders); the API (service-role) is the real guard.
- **Route home:** `app/dashboard/network`. **UI:** shared tokens in `lib/dashboard-theme.ts`
  (`T`, `input`, `select`/`selectOption`, `textarea`, `btnPrimary/Secondary`, `card`). No form or
  date library — controlled inputs + native `Date`/helpers. Refresh = client-side re-fetch, not `revalidatePath`.
- **Uploads** reuse the `/api/resume-upload` pattern: `multipart/form-data` → `req.formData()` →
  `file.arrayBuffer()` → `Buffer`, parsed server-side (nodejs runtime).

---

## 8. Future ideas — NOT scoped, NOT decided

**Bring back relationship-aware stage dimming.** The old 11-node stepper greyed the stages a
given relationship typically skips — `intro_requested` for a personal/affinity/cold contact,
`intro_requested` + `ask_made` for a recruiter — while leaving them fully clickable. It was
presentation only, never a restriction, and it was a genuinely good affordance: it told you what
the normal path looked like for *this* contact without ever getting in the way.

It did not survive the move to a `<select>` in the phase-bar rework — a native `<option>` cannot
carry that styling, and faking it with text markers inside the option labels would clutter the
one control that has to stay scannable. The mapping itself is not lost; it was
`SKIPPED_BY_RELATIONSHIP` in the pre-rework PipelineStepper (see git history at `9671d02e`).

Two plausible routes back: a **custom (non-native) dropdown** that can style its own rows, which
buys the dimming plus the phase colours in the open list too; or a **hint beside the phase bar**
("Personal contacts usually skip Intro requested") which is far cheaper and gets most of the
value without owning a bespoke listbox and its keyboard behaviour. The hint is the one to try
first — writing a custom dropdown to recover a presentation nicety is a poor trade.

**Contact discovery.** Help clients find *new* people to reach out to, driven by what the tracker
already knows: companies on the board with zero contacts (dream firms with nobody in them),
segments with a high reply rate ("do more of what's working"), and "find more like this contact"
after a good chat. Two delivery paths, both closing the loop with what's already built:
- **A research prompt whose output is a spreadsheet the existing importer eats** — the user (or a
  research step) produces a list in a format `import/preview` already understands, so discovered
  contacts flow straight back in with no retyping.
- **Generated LinkedIn boolean search URLs** for verification and warm-thread finding —
  **deep-link only, never scrape.**

Open questions before this is real: does the research run *inside* SIGNAL or get handed off to
the user? Does discovery live in its own tab, or surface *inside* empty states and the
dashboard's "needs attention" (e.g. "3 dream firms have no contacts — find some")? Related prior
art to reuse rather than reinvent: the **networking function in the JobFit engine**
(`app/api/networking` — the generator discussed in §3).
