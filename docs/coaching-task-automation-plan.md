# Coaching task automation: tasks, rules, and the Networking chain

Moving coaching task automation out of GoHighLevel and into SIGNAL. The
Networking campaign chain is the prototype: four tasks, three of them created or
completed by the system rather than by a person.

This plan covers the task model, the data-driven automation engine, the email
layer, and the order the work lands in.

---

## 1. The decisions

Taken 2026-09-24, in answer to the four open questions raised when this was
first proposed.

1. **A dedicated `coach_tasks` table.** Not new columns on
   `coach_client_notes`. See section 2 for why the existing shape could not
   absorb this.
2. **Status vocabulary is `open`, `done`, `cancelled`.** No `in_progress`. A
   reopened task returns to `open`; the reason lives in `coach_task_events`, not
   in a status.
3. **The `networking-plan-shared` GHL tag write is removed in the same change
   that adds the Postmark client email.** Two systems must never both own the
   client email. See section 6 for what was and was not confirmed about that tag.
4. **An assignee must be a coach profile** (`client_profiles.is_coach = true`),
   and exactly one profile per person is assignable.

### The assignable coaches in prod, as of 2026-09-24

| Profile id | Name | Email |
|---|---|---|
| `10467b45-ec49-42d3-8ddb-741c27c669df` | Coach: Peri Ginsberg | peri@workforcereadynow.com |
| `4d2a4399-e954-4da2-9289-3eeff78d2c5d` | Erin Condon | erin+coach@workforcereadynow.com |
| `f834571f-3b49-439d-9685-f8b248a56ef5` | Laura Laser | laura@laserpathways.com |

There is exactly **one** Erin coach profile: `4d2a4399`. Eleven prod profiles
match "erin" on name or email, and every other one is a client, including
`erin@workforcereadynow.com`, which is the client **Camila Ward**, and three
`erin+test*` aliases belonging to test clients. Erin Condon currently has zero
rows in `coach_clients` as a coach, which is expected for a delegate and does
not affect assignability.

---

## 2. What already exists, and what is new

### Exists

- **Action Items are not a table.** They are `coach_client_notes` rows with
  `type = 'action_item'`. 55 live rows in prod.
- That table also carries session recaps, prospect notes, activity notes and
  coaching notes: 161 live rows across three types, read by fourteen route
  files. It already has three type-conditional CHECK constraints.
- Columns today: `id, coach_client_id, coach_profile_id, client_profile_id,
  type, body, priority, completed_at, created_at, updated_at, deleted_at,
  link_tab`. `client_profile_id` is already nullable (59 nulls, from prospects).
- `/api/coach/action-items` serves the cross-client list. The Required Actions
  page composes that endpoint with heuristics from `/api/coach/home`, so it
  reads an endpoint and not a table.
- **Postmark is wired**: `lib/postmark.ts` plus four senders. One message
  stream. No Postmark templates anywhere; every sender hand-builds HTML.
- **The Networking Plan job** has the two hook points this needs:
  `runPlanJob` reaches `status: "complete"` after the PDF is filed, and
  `sharePlanJob` runs the share.
- **Cron convention**: five jobs in `vercel.json`, each an `/api/internal/*`
  route.

### New

- Task fields: title, assignee, due date, status, source, template link. None
  of these exist in any form today.
- Any notion of an assignee who is not the row's owning coach.
- Any automation engine: no events table, no rules, no templates.
- Postmark templates and a second message stream.

### Why `coach_client_notes` could not absorb this

Three of the requested fields invert what that table encodes. `coach_client_id`
is `NOT NULL` and anchors a note to a coach-client relationship, but a task's
client is optional. The owning coach is `coach_profile_id`, but a task's
assignee is frequently a different coach. And the table is read by fourteen
routes serving five unrelated features, each of which would inherit seven
columns and their constraints for no benefit.

The migration cost is one backfill of 55 rows. The alternative cost is
permanent.

---

## 3. Data model changes

### 3.1 `coach_tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | |
| `title` | `text NOT NULL` | backfilled from the first line of `body` |
| `description` | `text` | stored as plain text; links are linkified at render |
| `client_profile_id` | `uuid NULL` → `client_profiles` | optional |
| `coach_client_id` | `uuid NULL` → `coach_clients` ON DELETE SET NULL | set when client-scoped |
| `assignee_profile_id` | `uuid NOT NULL` → `client_profiles` | must be `is_coach` |
| `created_by_profile_id` | `uuid NULL` → `client_profiles` | NULL when `source = 'auto'` |
| `due_at` | `timestamptz NULL` | |
| `due_has_time` | `boolean NOT NULL DEFAULT false` | "time optional" without a second column |
| `status` | `text NOT NULL DEFAULT 'open'` | CHECK in (`open`, `done`, `cancelled`) |
| `completed_at` | `timestamptz NULL` | CHECK: non-null iff `status = 'done'` |
| `source` | `text NOT NULL DEFAULT 'manual'` | CHECK in (`manual`, `auto`) |
| `template_id` | `uuid NULL` → `coach_task_templates` | the template link |
| `chain_id` | `uuid NULL` | groups one run of a chain |
| `created_at` / `updated_at` / `deleted_at` | `timestamptz` | soft delete, house pattern |

**On `due_has_time`.** A due date with an optional time could be a `date` plus a
`time`, but then every overdue comparison has to reassemble them and decide what
a missing time means. One `timestamptz` plus a flag keeps overdue as a single
comparison, and the flag only changes how the date renders.

**On the assignee CHECK.** Postgres cannot enforce "references a row where
`is_coach` is true" with a plain foreign key. Enforced in `lib/tasks/service.ts`
on write, and by a nightly assertion in the digest job rather than a trigger.

Indexes:

- `(assignee_profile_id, status, due_at) WHERE deleted_at IS NULL`
  drives the dashboard card and the default "assignee = me" filter.
- `(client_profile_id) WHERE deleted_at IS NULL`
- `(status, due_at) WHERE deleted_at IS NULL AND status = 'open'`
  for the overdue digest.

RLS mirrors `coach_client_notes_owner_access`: belt and braces behind the
service-role plus bearer-token authz the routes already do.

### 3.2 `coach_task_events`

`id, task_id, kind, actor_profile_id, note, payload jsonb, created_at`.

`kind` in (`created`, `assigned`, `reassigned`, `completed`, `reopened`,
`cancelled`, `commented`).

This is where **Request Changes notes** live. Reopening the campaign task must
carry Peri's reason without overwriting the description Erin is working from.

### 3.3 `coach_task_templates`

`id, key` (unique slug), `title, description, default_assignee_profile_id,
due_offset_days int NOT NULL DEFAULT 1, decision_options text[] NULL,
auto_complete_event text NULL, active bool`.

`due_offset_days` defaults to 1 and is editable per template. The per-task
override is simply `coach_tasks.due_at`, which satisfies "editable per template
and per task" without a second offset column.

### 3.4 `coach_automation_events`

Append-only: `id, event_key, payload jsonb, client_profile_id, occurred_at,
processed_at, error`.

Writing the event and acting on it are deliberately separate. A rule that throws
leaves a row with an `error` and no `processed_at`, which is visible and
replayable. A rule that runs inline inside the profile-intake request would take
the client's form submission down with it.

### 3.5 `coach_automation_rules`

`id, event_key, action, template_id, target_template_key, condition jsonb,
active bool, sort_order`.

`action` in (`create_task`, `complete_task`, `reopen_task`).

### 3.6 `coach_email_log`

`id, to_email, template_alias, stream, dedupe_key (unique), task_id, sent_at,
error`. Idempotency, so a retry cannot double-send and the daily digest cannot
go out twice.

---

## 4. The Networking chain, as rows

| Event key | Condition | Action | Template or target |
|---|---|---|---|
| `client_profile.submitted` | | `create_task` | `networking.create_campaign` (Erin) |
| `task.completed` | template `networking.create_campaign` | `create_task` | `networking.review_campaign` (Peri) |
| `task.completed` | template `networking.review_campaign`, decision `approve` | `create_task` | `networking.upload_and_build` (Peri) |
| `task.completed` | template `networking.review_campaign`, decision `request_changes` | `reopen_task` | `networking.create_campaign` |
| `task.completed` | template `networking.upload_and_build` | `create_task` | `networking.share_plan` (Peri) |
| `networking_plan.generated` | | `complete_task` | `networking.upload_and_build` |
| `networking_plan.shared` | | `complete_task` | `networking.share_plan` |

Adding a second chain later is rows, not a deploy.

### 4.1 `complete_task` must no-op when there is no open match

**This is a correctness requirement, not a nicety.** At cutover there are
clients already part-way through networking: their plan exists, or has been
shared, and no SIGNAL task was ever created for them. When
`networking_plan.shared` fires for one of those clients, the rule looks for an
open `networking.share_plan` task, finds none, and must record the event as
processed and stop.

It must not create the task in order to complete it, and it must not raise. The
distinction that matters: **no matching open task is a normal outcome, not an
error.** The event row is marked `processed_at` with a `no_match` note so the
behaviour is auditable rather than silent.

`reopen_task` follows the same rule for the same reason.

### 4.2 Hook points

| Emits | Where |
|---|---|
| `client_profile.submitted` | `app/api/profile-intake/route.ts`, where `profile_complete` is set |
| `networking_plan.generated` | `lib/networking-plan/job.ts`, `runPlanJob`, at `status: "complete"` |
| `networking_plan.shared` | `lib/networking-plan/job.ts`, `sharePlanJob` |

---

## 5. Email

### STANDING RULE: every client-facing email carries the signature

Decided 2026-09-25. Not a convention to remember, a mechanism.

The Postmark **layout** `signal-client` holds the WRN logo header, the orange
hairline and the signature. A template that names that layout inherits all
three, so a new client-facing email gets them without restating anything.

Adding one is two steps, and the second is what enforces the first:

1. Create the template with `LayoutTemplate: "signal-client"`.
2. Send it with `sendToClient()` from `lib/email/send.ts`, which also applies
   the non-production redirect, the client stream and the subject prefix.

`lib/email/signature.ts` is the signature's only definition, and
`tests/email/sync-email-layout.ts` compiles it into the layout and pushes it.
Edit the module, re-run the script; never edit the layout in the Postmark UI,
because the next push would overwrite it.

Coach-facing mail is deliberately NOT signed: `sendToCoach()` uses the
internal stream and no layout. A task notification signed by the founder
would be odd, and internal mail has its own deliverability to protect.

Images are served from `public/logo/` on this Vercel project, a stable URL we
control and version with the code, rather than Postmark's asset store.

The signature's navy is `#25395C`, sampled from the existing artwork, and is
NOT the `#08203F` used for email body text. The wordmark in the SIGNAL logo is
that navy, so changing it would leave the logo disagreeing with the text
beside it. Worth unifying one day; worth doing deliberately, not silently.


One shared send function, `lib/email/send.ts`, taking a template alias, a model,
a stream and a dedupe key. Postmark templates rather than hand-built HTML.

Two streams: `POSTMARK_STREAM_INTERNAL` for coach mail (assignment,
reassignment, digest) and `POSTMARK_STREAM_CLIENT` for the client-facing plan
email. Separate streams keep a bounce on a client address from affecting
internal deliverability, and vice versa.

**`lib/postmark.ts` needs one fix first.** It throws at module load if
`POSTMARK_API_KEY` is missing. Once a shared sender is imported by the task
routes, that import-time throw would take down every one of them in any
environment lacking the key. The client becomes lazy.

Templates: `task-assigned`, `task-reassigned`, `overdue-digest`,
`networking-plan-shared`.

The digest is a new cron, `/api/internal/tasks/overdue-digest`, added to the
five already in `vercel.json`. One mail per coach, listing their overdue tasks,
skipped entirely when a coach has none.

---

### STANDING RULE: coach mail is redirected outside production too

`sendToCoach` redirects to `peri@workforcereadynow.com` and prefixes the
subject with `[<env> -> <intended>]` whenever `VERCEL_ENV` is not
`production`, exactly as `sendToClient` does. Every internal subject therefore
begins with `{{subject_prefix}}`, which renders empty in production.

It was not written this way at first, on the reasoning that internal mail goes
to three people who always open it. That reasoning is wrong in the one
environment it matters: **dev carries a copy of production's coach profiles**,
so a chain smoke that creates six tasks sends six genuine "you have a new
task" emails to real coaches about work that does not exist. Mail about
imaginary work is worse than mail nobody reads, because it gets acted on.

---

## 6. The GHL tag: what was confirmed and what was not

### Confirmed, on the SIGNAL side

`networking-plan-shared` is defined once, in `lib/ghl/contacts.ts` as
`NETWORKING_PLAN_TAG`, and touched in exactly three places, all in
`lib/ghl/networkingPlanSync.ts`: added on share, and removed then re-added by
the explicit "Re-send email" button. **Nothing in SIGNAL ever reads the tag
back.** No inbound GHL webhook consumes it: the only webhook SIGNAL exposes to
GHL is `app/api/seat-create/route.ts`, which is seat provisioning and does not
look at tags.

So removing the tag write breaks nothing inside SIGNAL.

### Not confirmed, on the GHL side

**I could not verify from here what the tag triggers inside GHL.** Two reasons,
and the second is the real one:

1. `.env.production.local` carries no GHL variables at all. `GHL_API_KEY` and
   `GHL_LOCATION_ID` exist only in Vercel, so a query would mean pulling prod
   credentials to disk.
2. More fundamentally, **the GoHighLevel v2 API does not expose workflow
   triggers or actions.** `GET /workflows/` returns id, name and status. There
   is no endpoint that answers "which workflows fire on tag X", so even with the
   key this question cannot be settled by API.

**The definitive check is in the GHL UI**: Automation, then search workflows
whose trigger is Contact Tag equals `networking-plan-shared`, and confirm the
only one is the client plan email. Worth also checking for a second workflow
that removes the tag or reacts to its removal, since the Re-send button removes
and re-adds it.

**SETTLED, 2026-09-26.** The check was made, the GHL workflow was the only
thing keying off the tag, and the tag write was removed in `1d4c49da`
alongside the Postmark client email, which is live in production. What is left
on the GHL contact is the note: an audit line so anyone working in GHL can see
the plan went out. It is not how the client is told and it never was. See
`lib/ghl/networkingPlanSync.ts`.

---

## 7. Files

### Migrations

- `..._coach_tasks.sql` — table, indexes, RLS
- `..._coach_task_automation.sql` — templates, rules, events, task events
- `..._coach_tasks_backfill.sql` — the 55 action items
- `..._coach_email_log.sql`
- `20260927_campaign_briefs.sql` — `networking_campaign_briefs`, plus `brief_id` on tasks, plan jobs and plan sources, plus `decision` on tasks

### Library

- `lib/tasks/model.ts` — types, status vocabulary, overdue and due-this-week predicates in one place
- `lib/tasks/service.ts` — create, update, complete, reopen, reassign; every mutation writes a `coach_task_events` row and emits an automation event
- `lib/automation/emit.ts` — append to `coach_automation_events`
- `lib/automation/run.ts` — match rules, apply actions, mark processed, including the no-match path
- `lib/email/send.ts` — the shared sender
- `lib/postmark.ts` — lazy client
- `lib/email/sendTaskEmails.ts` — assignment, reassignment, the reopen note, the digest
- `lib/briefs/model.ts` — the brief type, `toList`, the submit gate
- `lib/briefs/prefill.ts` — profile prefill, and the AI read of `profile_text` offered as suggestions
- `lib/briefs/resolve.ts` — which campaign an upload, build or share belongs to

### API

- `app/api/coach/tasks/route.ts` — list (views, filters, search) and create
- `app/api/coach/tasks/[taskId]/route.ts` — edit, delete
- `app/api/coach/tasks/[taskId]/complete/route.ts` — accepts a decision
- `app/api/coach/tasks/[taskId]/reassign/route.ts`
- `app/api/internal/tasks/overdue-digest/route.ts` — cron, 11:00 UTC
- `app/api/internal/automation/run/route.ts` — cron, every 30 minutes; the queue safety net
- `app/api/coach/briefs/route.ts` — this client's campaigns, and start one
- `app/api/coach/briefs/[briefId]/route.ts` — edit, submit, delete a draft
- `app/api/coach/action-items/route.ts` — repointed, response shape preserved

### UI

- `app/dashboard/coach/_tasks/TaskCard.tsx` — my overdue plus due this week, max 5, "View all"
- `app/dashboard/coach/tasks/page.tsx` — full list
- `app/dashboard/coach/_tasks/TaskFormModal.tsx` — add, edit, reassign
- `app/dashboard/coach/required-actions/page.tsx` — Action Items half now reads tasks
- `app/dashboard/coach/_tasks/TaskRow.tsx` — Approve / Request changes in place of the checkbox on a decision task
- `app/dashboard/network/CampaignBriefPanel.tsx` — the campaign bar and the brief form, on the client's networking board
- `app/dashboard/network/import/page.tsx` — the campaign picker on import

---

## 8. Steps

1. **Schema and backfill**, dev only. Tables, RLS, migrate the 55 action items,
   verify counts.
2. **Task CRUD and the full list.** Views, filters, search, add, edit, delete,
   reassign. No automation, no email. Usable on its own.
3. **Dashboard card and Required Actions.** Repoint `/api/coach/action-items`;
   Required Actions should render unchanged.
4. **Email.** Lazy Postmark client, shared sender, two streams, templates,
   `coach_email_log`. Assignment mail, then the digest cron. **Done on dev.**
5. **Automation engine.** Events, rules, runner, including the no-match no-op.
   Seed the Networking chain as rows. Exercise end to end on dev. **Done on
   dev**; `tests/automation/chain-smoke.ts`, 17 checks.
6. **Wire the auto-completes** into `runPlanJob` and `sharePlanJob`, add the
   Postmark client email, and remove the GHL tag write. Requires section 6
   confirmed first. **Done.** The Postmark client email and the tag removal
   shipped in `1d4c49da` and are live in production; the two auto-completes are
   wired on dev.
7. **The Campaign Brief.** The form that starts the chain, its history, the AI
   read of `profile_text`, the campaign picker on import. **Done on dev.**
8. **Prod.** Migrations, then promote, then seed template and rule rows.

---

## 8a. Crons

Both are in `vercel.json` and both take `Authorization: Bearer $CRON_SECRET`,
the convention `/api/internal/ingest/staleness` already uses.

| Path | Schedule (UTC) | What it is |
|---|---|---|
| `/api/internal/automation/run` | `*/30 * * * *` | Drains the queue. The safety net, not the primary path: every emit drains inline so the chain moves while the coach is still on the screen. This catches an event whose inline drain failed. |
| `/api/internal/tasks/overdue-digest` | `0 11 * * *` | One email per coach with overdue tasks. Coaches with none get nothing. |

**The digest hour drifts by one, twice a year.** Vercel crons are UTC and do
not follow a timezone, so `0 11` is 7am Eastern during daylight saving and 6am
once it ends. 11:00 was chosen over 12:00 because arriving an hour early in
winter beats arriving an hour after the working day has started. The fix, if
the hour ever matters more than the simplicity, is an hourly cron that returns
early unless it is 7am in `America/New_York`.

---

## 9. Open questions

1. Does any GHL workflow other than the client plan email key off
   `networking-plan-shared`? Section 6.
2. Do cancelled tasks stay visible in the full list behind a filter, or drop out
   of every view? Assumed: visible under an explicit status filter only.
3. Should a task whose client is later removed from the coach keep its
   `client_profile_id`? The FK is `ON DELETE SET NULL` on `coach_client_id`
   only, so the task survives as an unscoped task.
4. Who receives the digest for tasks assigned to a coach who is inactive?
   Assumed: nobody, and the assertion in step 4 flags it.

---

## 10. Coaches Center design: decided 2026-09-26

**The Coaches Center converts to the light theme, to match JobFit. Not now.**

The interim design is what shipped today: the existing dark ground, with one
accent per dashboard section driving the card's top rule, its icon and its
count pill.

| Section | Accent |
|---|---|
| Action Items | `#FF6B00` |
| Today's schedule | `#00B3B3` |
| My clients | `#009BFF` |
| My prospects | `#B6F2F8` |
| Engagement Signals | `#FFEEDC` |

### Priority order

1. **Tasks prod deploy**, once dev testing passes. See
   `docs/coaching-tasks-prod-deploy-plan.md`.
2. **Update `lib/theme/surfaces.ts` LIGHT to the new brand palette.** Its
   meaning accents are still the older set (`#F26B52` attention, `#E5397E`
   current, `#51ADE5` progress) while JobFit has moved to `#009BFF`, `#00B3B3`
   and `#FF6B00`. **Not started, deliberately.**
3. **Convert the coach dashboard to LIGHT**, keeping per-section identity.
   Screenshot for approval before it goes further.
4. **The remaining Coaches Center pages.**

2 comes before 3 on purpose. Converting a page against tokens that are about to
change means doing the colour work twice, and the second pass would be invisible
in a diff full of layout churn.

### What the conversion will actually involve

- **`LIGHT_ROUTES` in `app/dashboard/layout.tsx` is the opt-in.** A route is
  light because it is listed there, and the list is deliberately exact rather
  than prefix-matched (`"/dashboard"` converts the home and nothing below it).
  So the dashboard can convert alone, and `/dashboard/coach/*` stays dark until
  each page is named. Step 4 is adding entries one at a time.
- **The coach dashboard does not import `surfaces.ts` at all.** It is on
  `lib/dashboard-theme` (dark `#13294A` ground). The coaching hub and the
  network pages are already converted, so they are the worked examples.
- **Two JobFit rules have to survive the port**, because both are contrast
  decisions rather than taste: orange `#FF6B00` draws rules, numerals, eyebrows
  and bullets and never sets body text or fills a button (2.7:1 on the ground);
  and teal fails as text on white at 2.3:1, so every teal WORD takes the
  darkened `#00757A` while the brand teal stays for fills and rails.
- **Navy `#08203F` changes job.** On the dark ground it is invisible and unused;
  on light it is both the primary ink and the action colour, so every primary
  button becomes solid navy with white text.
- The five section accents above were chosen to read on navy. On a light ground
  `#FFEEDC` and `#B6F2F8` become fills rather than rules, so Engagement Signals
  and My prospects will need re-picking rather than porting.

---

## 11. Backlog, found here, not fixed here

Kept in this doc because there is no general backlog doc in the repo, and the
only existing one (`docs/jobfit-ticket1-plan.md`) is JobFit-scoped. Move these
if a real backlog lands.

**The profile parser drops secondary roles and never extracts education or
industries.** `app/api/profile/route.ts` parses `target_roles` out of
`profile_text` by taking the text between "Primary Roles:" and "Secondary
Roles:" and discarding the second half. There is no education field, no
industries field and no goals field on `client_profiles` at all.

This is why a Campaign Brief can only be prefilled with primary roles and
locations, and why everything else has to come from an AI read of
`profile_text` offered as a suggestion. The brief works around the gap rather
than closing it, deliberately: adding the columns is easy, but changing what
the parser writes changes the meaning of every profile already stored, and
`target_roles` feeds JobFit scoring. That is its own piece of work with its own
regression run, not a side effect of the networking build.

**A duplicate Lily Stein test profile in prod: `91e418e9`.** Found while
checking which profile fields are populated. Not touched. Worth cleaning up
alongside the Lukas duplicate `c902cde4`, and worth doing before the brief
reaches prod: a coach picking the wrong Lily would brief a campaign against an
empty profile and the prefill would silently produce nothing.
**The "ingest silent" staleness alert fires falsely.** On 2026-09-25 at 05:00
it emailed `[SIGNAL] ingest silent for 109h`, two hours after the Greenhouse
sweep ran at 03:01 and half an hour after SmartRecruiters ran at 04:30. Both
wrote 2,813 `ingest_runs` rows between them and added 681 postings, so the
claim is wrong rather than merely stale.

109 hours before that alert is roughly 2026-09-20, which is when the sweep
genuinely was broken by the `fetch_detail` schema drift. So the check looks to
be measuring from a point that stopped advancing rather than from the last
successful run. Worth confirming what it actually reads before changing it:
the condition is in `/api/internal/ingest/staleness`.

A monitor that cries wolf is worse than no monitor, because the next real
outage arrives looking exactly like the last four false ones. Not urgent, but
it should not sit indefinitely.

**Redesign the `networking-plan-ready` email.** Not urgent. The template shipped
2026-09-26 and its content is the copy as dictated, in a plain table layout with
a bulletproof button and a plain-text alternative. It has had no design pass and
does not follow the JobFit visual system: no brand ground, no orange rule, none
of the structural devices the product's other surfaces now use. Worth doing when
the Coaches Center light conversion settles the tokens, since an email designed
against the old palette would need redoing.

**Post-login redirect goes to the API host.** After a successful sign-in,
`framer/prod/maincomponent.txt` does
`window.top.location.replace("https://wrnsignal-api.vercel.app/dashboard")`.
That is the Vercel project URL for the API, not a branded domain, so a client
who signs in from the plan email ends the journey looking at
`wrnsignal-api.vercel.app` in the address bar. It needs a branded domain.

Two things make it worse than cosmetic, and both are why it is written down
rather than left as a note in a commit:

- The destination is **hardcoded and discards the original path**, which is why
  the plan email links to `/signal/jobfit` rather than deep-linking anywhere.
  A branded domain alone does not fix the deep-link problem; returning the user
  to where they came from is a separate change.
- It is the same class of problem `APP_BASE_URL` was added to solve, but on the
  Framer side, where this repo's environment variables do not reach. Fixing it
  means editing the Framer component in both dev and prod, per the house rule
  that Framer code lives in `framer/dev` and `framer/prod` and gets mirrored.

Deliberately not fixed as part of the task automation work.
