# Prod deploy: coaching tasks, and the client email moving to Postmark

Two changes ship together because they share a schema migration and a branch.
Neither is deployed. Everything below is dev-verified only.

Written 2026-09-26. Read section 6 before starting: the GHL shutoff has an
ordering constraint that the rest of the plan depends on.

---

## 1. What is going to prod

| Commit | What it does |
|---|---|
| `1d4c49da` | SIGNAL sends the client plan email via Postmark; GHL tag write removed |
| `74306340` | `APP_BASE_URL`, login link, task model and service |
| `924ac70c` | design mocks scrubbed |
| `62adb344` | task CRUD, full list, dashboard card |
| `05ccbb4c` | task rows as a table |
| `d106574f` | action item becomes a task; old endpoint retired |
| *(pending)* | client-page Tasks tab; action-item note type closed |

Six migrations, none of which exist on prod today. Verified absent:
`coach_tasks`, `coach_task_events`, `coach_task_templates`,
`coach_automation_events` and `coach_automation_rules` all return PGRST205, and
`networking_plan_jobs.client_email_*` returns 42703.

---

## 2. Migration order, and why it is this order

Run all seven **before** promoting. The deployed code reads these tables on the
coach dashboard, so code-first means every coach sees errors until the SQL
lands.

```
1.  20260926_coach_tasks.sql             tables, indexes, RLS
2.  20260926_coach_task_automation.sql   templates, rules, events, FK on coach_tasks
3.  20260926_coach_tasks_backfill.sql    the 55 action items
4.  20260926_plan_client_email.sql       4 nullable columns on networking_plan_jobs
5.  20260926_plan_jobs_reshare.sql       partial unique index on the plan jobs
6.  20260926_plan_sources.sql            networking_plan_sources
7.  20260927_campaign_briefs.sql         networking_campaign_briefs, brief_id x3, decision
```

**1 to 6 are already on prod** (applied 2026-09-26, re-verified by probing the
exact artifact each one creates). 7 is the only one outstanding.

**7 must follow 1 and 6**, because it adds a foreign key from `coach_tasks`,
`networking_plan_jobs` and `networking_plan_sources` to the new briefs table,
and all three have to exist first. It is purely additive: one new table, four
nullable columns, three indexes. Nothing it touches has existing data to
migrate, and every task already on prod keeps a null `brief_id`, which is what
"this task is not part of a campaign" means.

Reversal is in the migration header:

```sql
ALTER TABLE coach_tasks DROP COLUMN brief_id;
ALTER TABLE networking_plan_jobs DROP COLUMN brief_id;
ALTER TABLE networking_plan_sources DROP COLUMN brief_id;
DROP TABLE networking_campaign_briefs;
```

`coach_tasks.decision` is left in place on a reversal: it is a nullable TEXT
column nothing else reads, and dropping it would throw away how a review task
was closed.

Six, not four. Five and six landed after this plan was first written:

- **5** narrows `uq_networking_plan_jobs_source` to `WHERE shared_at IS NULL`.
  Without it, generating a plan returns the previously shared job and the
  screen claims a share the coach never made. It DROPS the old index and
  creates the partial one, so it is the only migration here that is not purely
  additive. Reversible while no client has two rows for one source hash.
- **6** adds `networking_plan_sources`, which stores the "Outreach Messages"
  rows at import so Build Networking Plan works without re-uploading the
  workbook.

2 must follow 1: it adds a foreign key to `coach_tasks.template_id`, and the
column has to exist first. 3 must follow 1 for the obvious reason. 4, 5 and 6
are independent of the task tables and of each other, but 5 touches
`networking_plan_jobs` and 4 adds columns to it, so running them in listed
order keeps one table's changes together.

All six are re-runnable and were re-run on dev to prove it. `CREATE POLICY` and
`ADD CONSTRAINT` have no `IF NOT EXISTS`, so they are guarded by hand:
`DROP POLICY IF EXISTS` and a `pg_constraint` lookup. A second pass changes
nothing rather than failing, which matters because prod has no migration tracker
to tell you whether a file already ran.

**How to run them.** The CLI can target prod explicitly:

```
npx supabase db query --linked --project-ref ejhnokcnahauvrcbcmic -f <file>
```

`--linked` alone points at DEV. Both flags together are required, and the CLI
refuses `--project-ref` without `--linked`. Confirm the target before the
first DDL with a query whose answer differs between the two databases, such as
the action-item count: 55 on prod, 18 on dev. The prod SQL editor remains a
fine alternative.

Only migration 5 changes anything that already exists, and what it changes is
an index rather than a row. No migration writes to an existing table's data:
the backfill inserts into a new table and leaves `coach_client_notes`
untouched.

---

## 3. Verifying the backfill against the 55

Run these straight after migration 3. The first two must hold or stop.

```sql
-- A. counts match
SELECT
  (SELECT COUNT(*) FROM coach_client_notes WHERE type = 'action_item') AS notes,
  (SELECT COUNT(*) FROM coach_tasks WHERE legacy_note_id IS NOT NULL)  AS tasks;
-- expect 55 and 55

-- B. nothing lost, nothing invented: zero rows
SELECT t.id, t.title
FROM coach_tasks t JOIN coach_client_notes n ON n.id = t.legacy_note_id
WHERE (t.description IS NULL     AND t.title       <> n.body)
   OR (t.description IS NOT NULL AND t.description <> n.body)
   OR ((n.completed_at IS NULL) <> (t.status = 'open'))
   OR t.due_at IS NOT NULL;

-- C. every assignee is really a coach: zero rows
SELECT t.id FROM coach_tasks t
JOIN client_profiles p ON p.id = t.assignee_profile_id
WHERE p.is_coach IS NOT TRUE;

-- D. the original priority survived onto the audit event
SELECT COUNT(*) FROM coach_task_events
WHERE kind = 'created' AND payload->>'legacy_priority' IS NOT NULL;
-- expect 55
```

Pre-checked against prod on 2026-09-24, so these should pass:

- 55 action items, 0 soft-deleted, 48 already completed, 25 with no client
- every `coach_profile_id` on those 55 is a real coach (3 distinct coaches)
- no empty bodies
- **one** row has a first line over 200 characters, which is the case the
  title/description split exists for. Expect exactly one task where
  `description IS NOT NULL`. Check B covers it.

### The urgent ones, for assigning due dates afterwards

Every migrated task arrives with `due_at` NULL, deliberately: mapping a
priority onto a date would have invented deadlines nobody chose and pushed them
into the overdue digest on day one.

Prod has **16** urgent action items. **15 of them are already done**, so they
need nothing. The list to triage after migration is one row:

| Status | Client | Item |
|---|---|---|
| **OPEN** | Harry Bakalis | "Find 10 interesting jobs for Harry" |

The 15 completed urgent items, for the record: Kristin Blakely (touch base with
Jacob), Catherine Lees (internship JD draft), *no client* (Erin / marketing
campaign), Josh Rosenblatt (LinkedIn status), Allison Rutstein ×2 (marketing
plan, Barton mock interview script), Jacob Faski (new applications), Alexander
Nachman ×2 (find jobs, coffee chat sheet), Harry Bakalis (key people at top 4
companies), *no client* (resume and LinkedIn audit v2), Ian Dean (FIG and Sales
resume), Lindsay Kuperman (review applications), Alex Dupuy ×2 (update resume,
LinkedIn audit).

Dev has 2 urgent, both open, for comparison during testing.

To find them after the migration:

```sql
SELECT t.id, t.title, p.name AS client
FROM coach_tasks t
JOIN coach_task_events e ON e.task_id = t.id AND e.kind = 'created'
LEFT JOIN client_profiles p ON p.id = t.client_profile_id
WHERE e.payload->>'legacy_priority' = 'urgent'
  AND t.status = 'open' AND t.deleted_at IS NULL;
```

---

## 3a. Seeding the Networking chain

**Creating the tables is not the same as filling them.** `coach_task_templates`
and `coach_automation_rules` are empty on a fresh prod, so a submitted brief
would save and start nothing: the runner would find no rule, record `no_rule`,
and the coach would wait for a task that is not coming.

```
SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod> \
  npx tsx tests/automation/seed-networking-chain.ts
```

Four templates and seven rules. Re-runnable: templates upsert on `key`, and the
rules for this chain's event keys are deleted and reinserted, because a rule has
no natural key and leaving the old set behind would double every create.

**The assignees are resolved by email, not written as ids**, which is what makes
the script portable between dev and prod. On prod the two that matter are:

| Role | Email | Profile |
|---|---|---|
| Builder | `erin+coach@workforcereadynow.com` | Erin Condon, `is_coach` true |
| Reviewer | `peri@workforcereadynow.com` | Coach: Peri Ginsberg, `is_coach` true |

Those are the script's defaults, so no overrides are needed on prod. **Plain
`erin@workforcereadynow.com` in prod is a CLIENT, Camila Ward**, and the script
refuses a non-coach rather than assigning work to her.

---

## 4. Environment

`APP_BASE_URL` is already set on Production, Preview and Development to
`https://wrnsignal.workforcereadynow.com`, and the value was read back to
confirm it.

Nothing else is needed. `POSTMARK_API_KEY` and the Supabase keys are shared
across all three environments already, which is exactly why the Preview
deployment reads prod data and why the migrations must precede the promote.

The `signal-client` and `signal-internal` Postmark streams and the
`networking-plan-ready` template already exist **in production**: there is one
Postmark server behind all environments, so creating them created them there.
Nothing sends on them yet.

---

## 5. Promote

House rule: promote from the dev Preview, never a main-branch build.

```
git push origin dev
vercel promote <dev preview url> --yes
```

`vercel promote` refuses to alias a preview-target build directly and instead
builds a fresh deployment with production environment variables. That is
expected and is how the last promote went.

Confirm afterwards that `wrnsignal-api.vercel.app` resolves to the new
deployment and record the replaced deployment id as the rollback target.

---

## 6. GHL workflow shutoff, and its ordering

**The tag write is already gone from the code.** `1d4c49da` removed
`NETWORKING_PLAN_TAG`, `addContactTags` and `removeContactTags` entirely.
Confirmed beforehand that the `networking-plan-shared` tag triggers exactly one
GHL workflow (Email + GHL Note) and nothing else.

So from the moment of the promote, **SIGNAL stops writing that tag**, which
means the workflow stops firing by itself. There is no window where both send:
the Postmark send and the tag removal are in the same commit.

The ordering that matters:

1. **Migrations first.** `client_email_sent_at` and friends must exist before
   the new share path runs, or a share will email the client and then fail to
   record it. The email is the irreversible half, so it must not run against a
   schema that cannot log it.
2. **Then promote.** New shares send via Postmark.
3. **Then turn the GHL workflow off**, at leisure. Leaving it enabled is
   harmless once nothing applies the tag; turning it off before the promote is
   what would be harmful, because a share between then and the promote would
   tell nobody.

Do **not** delete the `networking-plan-shared` tag from existing contacts. It is
the historical record of who was told before this change, and `ghl_tagged_at` on
`networking_plan_jobs` is its counterpart in our database. Both are deliberately
left in place.

### First live share, checked deliberately

Outside production the new sender redirects client mail to
peri@workforcereadynow.com with the intended recipient in the subject, so a
preview deploy cannot reach a client. **Production has no such guard, by
design.** So watch the first real share:

```sql
SELECT id, shared_at, client_email_sent_at, client_email_to,
       client_email_sent_count, client_email_error
FROM networking_plan_jobs
ORDER BY shared_at DESC NULLS LAST LIMIT 5;
```

`client_email_to` must be the client's own address. If it says
peri@workforcereadynow.com, `VERCEL_ENV` is not `production` on that deployment
and the guard has misfired in the safe direction.

---

## 7. Rollback

**The code**: `vercel promote` the previously recorded production deployment.
That restores the GHL tag path and the old Action Items surfaces in one step.

**The schema**: do not roll it back. All four migrations are additive, nothing
existing reads the new tables, and dropping them would destroy the backfill and
any task created since. A code rollback with the schema left in place is a
consistent state: the old code never knew these tables existed.

The one thing to know: **tasks created while the new code was live are not
visible to the old code.** They are not lost, they are in `coach_tasks`, but a
rolled-back dashboard reads `coach_client_notes` and will not show them. If a
rollback lasts more than a day, that gap is worth listing:

```sql
SELECT id, title, assignee_profile_id, created_at
FROM coach_tasks
WHERE legacy_note_id IS NULL AND deleted_at IS NULL
ORDER BY created_at;
```

**The client email**: nothing un-sends an email. If Postmark sending is wrong,
the fix is forward, not back: the rollback restores the GHL tag path, which
would then re-notify anyone shared with in between, because their contact no
longer carries the tag. Check that list before rolling back a share-path
problem.

If only the emails are wrong and tasks are fine, prefer disabling the send over
a full rollback: unset `APP_BASE_URL` on production. `signalLoginUrl()` throws
without it, the send is skipped, the failure is recorded in
`client_email_error`, and the share itself still completes. That is a deliberate
one-variable off switch.

---

## 8. What this plan does not cover

- **The automation engine is not built.** Templates, rules and events have
  tables and no runner. The Networking chain is Step 5.
- **The overdue digest and assignment emails are not built.** Step 4. The
  `signal-internal` stream exists and is unused.
- **`type='action_item'` notes still exist on prod** and still render in the
  notes feed as history. Creation is closed; the 55 rows stay where they are.
- **`20260920_fingerprint_location_count.sql` remains queued** and unrelated.
  Run it before any Workday board reaches prod `ingest_boards`.
