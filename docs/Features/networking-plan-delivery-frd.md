# Networking Plan delivery

One coach action, after the contacts import is confirmed: turn the workbook's
**Outreach Messages** tab into a branded PDF, put it in the client's Networking
folder on our Shared Drive, and file it in the client's library, hidden. A
separate, explicit **Share with client** action is what reaches the client.

Companion to `docs/network-tracker/coach-contacts-import.md`, which covers the
import this workflow follows.

**Status: plan only. Nothing here is built.**

## Scope

Three steps run as one job:

1. **Generate** a Networking Plan PDF from the workbook's `Outreach Messages` tab.
2. **Upload** it to the client's Networking folder in our Shared Drive.
3. **File** it in the client's library as `<Client Name> - Networking Plan`,
   with `visible_to_client = false`.

Then, later and deliberately, one button:

4. **Share with client** flips `visible_to_client` to true **and** turns on
   anyone-with-the-link viewer access on that one PDF.

**SIGNAL does not draft, send, or store any email.** An earlier draft of this
plan had SIGNAL compose a client email for the coach to review; that is removed.
The coach writes to their client from their own mailbox, as they do today. This
also keeps the workflow out of deliverability, sending identity, and the
question of what happens to a draft nobody sends.

## Why the two-phase shape

The library's own rule is that nothing reaches the client until a coach
explicitly shares it. A job that created a visible entry would break that rule
the moment a step later in the chain failed, leaving the client looking at a
plan the coach had not finished checking.

Splitting delivery from creation also gives the job a clean commit point: steps
1 to 3 are recoverable plumbing with no audience, and step 4 is a single
reversible act with one reader.

## Decisions taken

| Question | Decision |
|---|---|
| Drive auth | A service account, with our Shared Drive |
| Email | None. SIGNAL neither drafts nor sends |
| PDF | HTML to PDF with headless Chromium, matching the approved Noah Networking Plan design |
| Client visibility | Created hidden; a Share action flips it and grants Drive access |
| Drive sharing | Anyone with the link, `reader`, on the FILE only. No per-email grants, never the folder |
| Re-runs | Update the same file as a new revision; the library entry and its link do not change |
| File name | `<Client Name> - Networking Plan.pdf`, the same string as the library title |
| Folder lookup | `drive_folder_id` on `coach_clients`, resolved once from a pasted folder URL |

## Authentication

A **single Google service account**, member of our Shared Drive. No consent
screen, no per-coach tokens, no reconnect prompts, and nothing to revoke when a
coach leaves.

The Shared Drive matters and is not incidental: a service account writing into
someone's *My Drive* consumes the service account's own storage quota and cannot
hand ownership to a person. In a Shared Drive the **Drive owns the file**, which
is also the right answer for client work that must outlive any one coach's
account.

Credentials live in env, the way `GOOGLE_ADS_*` already does:

```
GOOGLE_DRIVE_SA_EMAIL
GOOGLE_DRIVE_SA_PRIVATE_KEY      # newlines escaped, unescape on read
GOOGLE_DRIVE_SHARED_DRIVE_ID
GOOGLE_DRIVE_CLIENTS_ROOT_ID     # parent folder for per-client folders
```

Scope: `https://www.googleapis.com/auth/drive` (the service account only ever
sees what the Shared Drive membership exposes, so the broad scope is bounded by
the membership rather than by the scope string). Tokens are minted per request
from the service account JWT; there is nothing to store and nothing to refresh.

**Every Drive call passes `supportsAllDrives: true`** (and `includeItemsFromAllDrives`
plus `corpora: 'drive'` on lists). Omitting these is the single most common way a
Shared Drive integration appears to work in testing and then cannot see anything
in production.

## Finding the client's folder

Store the id. Never search by name at run time: name lookup breaks on duplicates,
renames, trashed copies, and folders the credential cannot see, and its failure
mode is finding the *wrong* folder rather than none.

**New column on `coach_clients`** (the relationship owns coaching artifacts, and
the column dies with the relationship):

```sql
ALTER TABLE public.coach_clients
  ADD COLUMN IF NOT EXISTS drive_folder_id  text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text;
```

Populated once by the coach pasting the folder URL. Accepted forms:

```
https://drive.google.com/drive/folders/<ID>
https://drive.google.com/drive/u/0/folders/<ID>?usp=sharing
https://drive.google.com/drive/folders/<ID>/subfolder
```

Parse rule: take the path segment after `folders/`, strip any query or fragment.
Then **verify before storing**: `files.get(id, fields: 'id,name,mimeType,driveId,trashed')`
must return a folder, not trashed, whose `driveId` is our Shared Drive. Store the
resolved name alongside so the settings screen can show which folder is wired up.

Failures worth their own message, because they are the ones that will actually
happen:

| Condition | Message |
|---|---|
| Not a folder URL | "That does not look like a Drive folder link." |
| 404 to the service account | "We cannot see that folder. Share it with the SIGNAL service account, or pick a folder inside the Shared Drive." |
| Folder is in a personal Drive | "That folder is not in the Shared Drive. Move it, or pick one inside it." |
| Trashed | "That folder is in the trash." |

If `drive_folder_id` is empty when a job runs, create
`<GOOGLE_DRIVE_CLIENTS_ROOT_ID>/<Client Name>/Networking`, then **persist the id
immediately**, so the convention is derived exactly once and never re-derived.

## The PDF

HTML to PDF with headless Chromium, rendering the approved design. The HTML
template is supplied and lives in the repo; the tab's rows are the data.

Shape of the source data, from `Outreach Messages`:

```
Channel | Touch | When | Subject line | Message | How to use it
Email   | 1     | Day 0                | ...
Email   | 2     | Day 7 (reply to your own thread) | ...
LinkedIn| 1     | Day 0 | (no subject) | ...
```

Notes that decide the implementation:

- **Chromium is a heavy dependency.** On Vercel this means `puppeteer-core` plus
  a Chromium build packaged for Lambda. It fits (functions allow up to 5 GB and
  300 s), but it is the largest thing in the deployment and it will dominate cold
  start. It is justified only because the design must match exactly. If the
  design later tolerates approximation, pdf-lib removes the whole dependency.
- **Rendering is pure.** Same tab plus same template gives the same PDF, so the
  bytes never need storing: a retry regenerates rather than resumes. This is why
  no Supabase Storage bucket appears anywhere in this plan.
- **The template must not fetch anything at render time.** Fonts and the logo are
  inlined or read from `public/`; a template that reaches the network turns a
  deterministic step into a flaky one.
- Untrusted content in the tab is the client's own text, but it is still
  interpolated into HTML: escape it. A stray `<` in a message must not reshape
  the page.

## Sharing

The Share action makes exactly one Drive call, on the **file**, never the folder:

```
permissions.create(fileId, {
  role: 'reader',
  type: 'anyone',
  allowFileDiscovery: false,   // link-only, not indexed or searchable
}, { supportsAllDrives: true })
```

Then, and only after that call succeeds, `visible_to_client` flips to true.

**The folder is never shared.** A folder grant would expose every other client
document that happens to live beside the plan, and it would outlive this one
file. Sharing the file keeps the blast radius to the artifact the coach chose.

**What anyone-with-the-link actually means.** The PDF becomes readable by anyone
who has the URL, with no sign-in. The id is long and unguessable, so this is not
public in the discoverable sense, but it is unauthenticated: a forwarded link
works for whoever receives it. For a networking plan of outreach templates that
is a reasonable trade for the friction it removes. It would not be a reasonable
trade for anything carrying a contact list, notes about a person, or anything a
client would be upset to see resurface.

**Unsharing has to exist.** Because access rides on the link rather than on an
identity, revoking means deleting that permission:
`permissions.delete(fileId, permissionId)`. Two cases make it necessary:

1. The coach shared the wrong plan, or the wrong client.
2. The coaching relationship ends. The library row already disappears for the
   client when the link goes inactive (shipped 2026-09-22), **but the Drive link
   keeps working**, because Drive knows nothing about `coach_clients`. Hiding the
   row is not revocation. Unshare must be its own action, and ending a
   relationship should prompt for it.

Store the created `permissionId` on the job row so the unshare is exact rather
than a search through the file's permissions.

## Workspace settings that can block this

**I cannot read your Workspace configuration from the repo, so this is what to
check rather than an answer.** Three separate settings can each refuse an
anyone-with-the-link grant, and they live in different places:

1. **Domain sharing policy.** Admin console, Apps, Google Workspace, Drive and
   Docs, Sharing settings. If external sharing is off, or limited to trusted
   domains, `type: 'anyone'` is refused.
2. **Link sharing specifically.** The same screen separately controls whether
   files may be made available to anyone with the link, as distinct from sharing
   with named external people. A domain can allow the second and forbid the
   first, which is exactly the combination that breaks this design while
   per-email sharing would have worked.
3. **The Shared Drive's own restrictions.** Each Shared Drive can restrict
   sharing further than the domain policy, including blocking non-members
   entirely. A Shared Drive may be stricter than the domain, never looser.

**How to find out in one minute, without code:** open any file already in that
Shared Drive, click Share, and look at the general-access dropdown. If "Anyone
with the link" is missing or greyed out, this design is blocked, and it is much
better to know that now than from a failed job.

**If it is blocked**, the fallback is per-email sharing with the client's Google
account, which was the previous draft of this plan. It is more private and more
work: it needs a real Google address per client, and Drive sends an invitation
we do not control.

**Behaviour when refused:** the API returns 403 on `permissions.create`. Treat it
as a first-class outcome rather than a crash: leave `visible_to_client` false,
keep the job row, and tell the coach that Drive sharing is disabled by policy,
not that something went wrong.

## The job table

```sql
CREATE TABLE IF NOT EXISTS public.networking_plan_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who it is for. coach_client_id is the relationship, client_profile_id the
  -- board, both denormalized the way coach_client_documents does it.
  coach_client_id   uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id),
  created_by_id     uuid NOT NULL,          -- the coach's profile id

  -- Idempotency: the same workbook for the same client is the same job.
  -- A second click returns the existing row instead of starting a second run.
  source_hash       text NOT NULL,

  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed')),
  -- The furthest step that has SUCCEEDED, so a resume knows where to start.
  step              text NOT NULL DEFAULT 'none'
    CHECK (step IN ('none','generated','uploaded','filed')),

  drive_file_id     text,                   -- set once, reused on every retry
  drive_file_url    text,
  document_id       uuid REFERENCES public.coach_client_documents(id) ON DELETE SET NULL,

  shared_at           timestamptz,          -- when "Share with client" succeeded
  drive_permission_id text,                 -- so unsharing is exact, not a search

  error             text,                   -- last failure, operator-readable
  attempts          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_networking_plan_jobs_source
  ON public.networking_plan_jobs (coach_client_id, source_hash);
```

`step` is deliberately "what finished", not "what is next": a crash between two
steps then reads as the earlier value, which is the safe direction.

## Recovery

Four steps across two external systems and two databases, with no transaction
spanning them. The plan is not to avoid partial failure but to make every step
**idempotent**, so re-running a half-finished job is always correct.

| # | Step | Fails how | What happens on retry |
|---|---|---|---|
| 1 | Generate | Tab missing, columns renamed, template error | Nothing external happened. Fail before any write, showing the parsed rows the way the import dry run does |
| 2 | Upload | Timeout after the file was created; rate limit; quota | `drive_file_id` is set inside the same job row, so a retry calls `files.update` on that id and produces a **new revision, not a second file**. Before the first upload, look for `appProperties.signal_job_id = <job>` to catch a lost response |
| 3 | File in library | Insert fails, or the coach's access changed mid-run | `drive_file_id` is already durable; the retry inserts the library row against it. `document_id` makes a second insert impossible |
| 4 | Share | Drive permission call fails, or policy forbids link sharing | Flip `visible_to_client` **after** the permission call succeeds, so the failure mode is "the client cannot see it yet" rather than "the client sees a link they cannot open". A 403 from domain policy is reported as policy, not as a bug |

**The ordering rule**, which is most of the design: pure work first, external
writes next, and the act with an audience last. Anything that fails before step 4
is invisible to the client by construction.

**Duplicate clicks** are absorbed by `uq_networking_plan_jobs_source`. The second
request finds the existing job and returns its state.

**Timeouts.** Chromium plus an upload will not reliably finish inside the 30 to
60 second ceilings the current network routes use. Set `maxDuration` on this
route (up to 300 s) and keep each step independently resumable, so a hard stop
costs one step rather than the job. A cron sweep can retry jobs left `running`
for more than a few minutes, using the same resume path the button uses.

**Drive specifics that bite.** `403 userRateLimitExceeded` and `429` need
exponential backoff with jitter. `404` on a file id usually means someone moved
or trashed it by hand: surface that plainly rather than silently re-uploading, or
the library link will point at a file that no longer exists.

**Revocation interacts with sharing**, and with link sharing the gap is wider
than it looks. Ending a coaching relationship hides the library row from the
client immediately, but the Drive link keeps working for anyone holding it. See
"Unsharing has to exist" above: the job row keeps `drive_permission_id` so the
grant can be removed precisely.

## Access rules

Identical to the importer, because it is the same act by the same person:

- Running the job requires an **active** `coach_clients` link at **full** access.
- Share with client requires the same.
- The client never triggers any of this.
- The library row is written with coach attribution, as library rows already are.

## Settled

1. **Sharing model.** Anyone with the link, viewer, on the file only. No
   per-email grants, and the folder is never shared.
2. **Re-runs.** A new workbook updates the same Drive file as a new revision and
   keeps the same library entry, so a link the client already holds keeps working
   and shows the current plan. The job row's `source_hash` changes; the
   `drive_file_id` does not.
3. **File name.** `<Client Name> - Networking Plan.pdf`, matching the library
   title exactly, so the two cannot drift apart.
4. **Client email.** Not needed anywhere. Nothing is shared per person and SIGNAL
   sends no mail, so `client_profiles.email` never enters this workflow.

Still open, and worth deciding before build:

- Whether ending a coaching relationship should **prompt** the coach to unshare
  or do it automatically. Automatic is safer and surprising; prompting is honest
  and can be ignored.
- Whether a re-run that lands while a plan is already shared should tell the
  client anything. As designed it silently updates the file under the existing
  link.

## Testing

Mirrors the importer's two layers:

- **Pure**: folder-URL parsing (every URL form plus the rejections above),
  `source_hash` stability, and template escaping of contact-supplied text.
- **Live, dev only**: a probe against a running API and a real Shared Drive test
  folder, asserting that a second run updates rather than duplicates, that a
  failure at step 3 leaves no client-visible artifact, that Share grants Drive
  access and flips the flag together, and that view / annotate / pending /
  paused / revoked are all refused. It cleans up the Drive file and the job row
  it created, the way `tests/network-tracker/import-authz.live.ts` does.

## Rollout

Dev first, against a dedicated test folder in the Shared Drive. The service
account is added to the Shared Drive once, by hand. Prod needs the four env vars
and the two migrations (`coach_clients` columns, `networking_plan_jobs`) applied
**before** the code is promoted, per the schema-before-code rule in
DEVELOPMENT.md.
