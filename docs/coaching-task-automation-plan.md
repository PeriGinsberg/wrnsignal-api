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

Until that is confirmed, section 1 decision 3 stands as a decision, not as a
verified safe change. The tag removal is Step 6, so there is time.

---

## 7. Files

### Migrations

- `..._coach_tasks.sql` — table, indexes, RLS
- `..._coach_task_automation.sql` — templates, rules, events, task events
- `..._coach_tasks_backfill.sql` — the 55 action items
- `..._coach_email_log.sql`

### Library

- `lib/tasks/model.ts` — types, status vocabulary, overdue and due-this-week predicates in one place
- `lib/tasks/service.ts` — create, update, complete, reopen, reassign; every mutation writes a `coach_task_events` row and emits an automation event
- `lib/automation/emit.ts` — append to `coach_automation_events`
- `lib/automation/run.ts` — match rules, apply actions, mark processed, including the no-match path
- `lib/email/send.ts` — the shared sender
- `lib/postmark.ts` — lazy client

### API

- `app/api/coach/tasks/route.ts` — list (views, filters, search) and create
- `app/api/coach/tasks/[taskId]/route.ts` — edit, delete
- `app/api/coach/tasks/[taskId]/complete/route.ts` — accepts a decision
- `app/api/coach/tasks/[taskId]/reassign/route.ts`
- `app/api/internal/tasks/overdue-digest/route.ts`
- `app/api/coach/action-items/route.ts` — repointed, response shape preserved

### UI

- `app/dashboard/coach/_tasks/TaskCard.tsx` — my overdue plus due this week, max 5, "View all"
- `app/dashboard/coach/tasks/page.tsx` — full list
- `app/dashboard/coach/_tasks/TaskFormModal.tsx` — add, edit, reassign
- `app/dashboard/coach/required-actions/page.tsx` — Action Items half now reads tasks

---

## 8. Steps

1. **Schema and backfill**, dev only. Tables, RLS, migrate the 55 action items,
   verify counts.
2. **Task CRUD and the full list.** Views, filters, search, add, edit, delete,
   reassign. No automation, no email. Usable on its own.
3. **Dashboard card and Required Actions.** Repoint `/api/coach/action-items`;
   Required Actions should render unchanged.
4. **Email.** Lazy Postmark client, shared sender, two streams, templates,
   `coach_email_log`. Assignment mail, then the digest cron.
5. **Automation engine.** Events, rules, runner, including the no-match no-op.
   Seed the Networking chain as rows. Exercise end to end on dev.
6. **Wire the auto-completes** into `runPlanJob` and `sharePlanJob`, add the
   Postmark client email, and remove the GHL tag write. Requires section 6
   confirmed first.
7. **Prod.** Migrations, then promote, then seed template and rule rows.

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
