# Networking Plan delivery: HTML → PDF → Drive → client

Status: **plan only, nothing built.** Written 2026-09-22.

Records four decisions and what they imply. Where this document states a fact
about the current codebase it was checked against prod and the repo on
2026-09-22; where it states an assumption it says so.

---

## 1. The decisions

| # | Decision |
|---|---|
| 1 | **Option A** — one Google service account writing into **our** Shared Drive. Not per-coach OAuth, not the coach's own Drive. |
| 2 | **SIGNAL drafts the client email; the coach reviews and sends it from their own mailbox.** No Postmark, no send-on-behalf. |
| 3 | **HTML → PDF via headless Chromium**, matching the approved Noah Networking Plan design. Peri supplies the HTML. |
| 4 | **Library entry is created hidden.** When the coach approves the email, two things flip together: `visible_to_client = true` **and** the Drive PDF is shared with the client's email as viewer. `drive_folder_id` lives on `coach_clients`, set from a pasted folder URL. |

Decision 1 is restated from a one-line brief; the options it was chosen over
are not recorded here because they were not in this conversation.

### Why Option A is the right shape, on its own merits

A service account has **no personal Drive storage quota**. A file it creates in
*My Drive* belongs to an account that cannot own storage, which is the classic
way this integration fails in production once the free tier is exhausted. Files
created in a **Shared Drive** are owned by the Shared Drive, not the service
account, so the quota problem does not arise. Decision 1 pairs the service
account with a Shared Drive, which is the combination that works. Splitting them
(service account + My Drive) is the one variant to avoid.

---

## 2. What already exists, and what is new

Checked against prod, 2026-09-22.

### Exists

| Thing | State |
|---|---|
| `coach_clients` | 74 rows. **No `drive_folder_id` column.** |
| `coach_client_documents` | 12 rows. This *is* the library. Has `visible_to_client` (default `false`), `url TEXT NOT NULL`, `title`, `coach_client_id`, `coach_profile_id`, `client_profile_id`, `category_id`, `sort_order`, `deleted_at`. |
| Library write route | `app/api/coach/coach-clients/[id]/documents/route.ts`. Already guards with `getOwnedRelationship` + `libraryAccessDenied(rel, "write")`, and already defaults `visible_to_client` to `false` with the comment *"nothing reaches the client until explicitly shared"*. Decision 4 is consistent with the posture the route already takes. |
| `lib/email/` | Four Postmark senders. **None of them are used by this feature** (decision 2). |
| Cron infrastructure | `vercel.json` has 5 crons; ingest routes run at `maxDuration = 800` (the Pro ceiling). |

### New — none of this is present anywhere in the repo today

| Thing | Note |
|---|---|
| Any job / queue table | `jobs`, `job_queue`, `async_jobs` all absent (`PGRST205`). Nothing to extend. |
| Any PDF dependency | No `puppeteer`, `playwright`, `chromium`, or `pdf*` in `package.json`. |
| Any Google dependency | No `googleapis`, no `google-auth-library`. |
| Any "Networking Plan" code or doc | Zero references in `.ts`, `.sql` or `.md`. The design exists outside the repo. |

So this is four new pieces (Drive client, renderer, job table, approve flow)
bolted onto one existing table, not an extension of something already running.

---

## 3. Data model changes

### 3.1 `coach_clients.drive_folder_id`

```sql
ALTER TABLE public.coach_clients
  ADD COLUMN IF NOT EXISTS drive_folder_id text;
```

Nullable: most of the 74 rows will not have one, and a client without a folder
simply cannot have a plan generated yet.

**Store the id, not the URL.** The coach pastes a URL; we parse and store the
id. Drive folder URLs come in several shapes and the id is the only stable part:

```
https://drive.google.com/drive/folders/<ID>
https://drive.google.com/drive/u/0/folders/<ID>
https://drive.google.com/drive/folders/<ID>?usp=sharing
https://drive.google.com/open?id=<ID>
```

Parse rule: take the segment after `/folders/`, else the `id` query parameter,
else reject. **Reject rather than guess** — a wrong folder id writes a client's
plan into another client's folder, which is the worst failure this feature has.

Validate on paste by calling `files.get(fileId, fields=id,name,driveId,mimeType,
capabilities/canAddChildren)` as the service account and confirming:

- it resolves at all (the service account can see it),
- `mimeType` is `application/vnd.google-apps.folder`,
- `driveId` is present (it is in a **Shared Drive**, not someone's My Drive),
- `capabilities.canAddChildren` is true.

Show the folder **name** back to the coach before saving. A silent save of an
unverified id is how the wrong-folder failure happens.

### 3.2 The job table

Generation is slow (Chromium cold start + render + upload), can fail in the
middle, and must be resumable. It needs a row per attempt.

```sql
CREATE TABLE public.networking_plan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO IT IS FOR
  coach_client_id   uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  coach_profile_id  uuid NOT NULL REFERENCES public.client_profiles(id),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id),

  -- LIFECYCLE. One row moves forward through these; it never moves back.
  --   queued     -> nothing has happened yet
  --   rendering  -> Chromium has the HTML
  --   uploading  -> PDF exists locally, Drive does not have it
  --   awaiting_approval -> PDF in Drive, library row hidden, email drafted
  --   approved   -> visible_to_client flipped AND client granted viewer
  --   failed     -> gave up; failure_reason says where
  status text NOT NULL DEFAULT 'queued',

  -- WHAT IT PRODUCED, filled in as it goes. Each is null until its stage passes.
  drive_file_id    text,
  drive_file_url   text,
  document_id      uuid REFERENCES public.coach_client_documents(id) ON DELETE SET NULL,
  email_subject    text,
  email_body       text,

  -- WHAT IT COST AND WHY IT STOPPED
  attempts      integer NOT NULL DEFAULT 0,
  failed_stage  text,
  failure_reason text,

  -- The HTML actually rendered, so a PDF can be explained after the fact.
  source_html_sha256 text,

  requested_by uuid REFERENCES public.client_profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  shared_at    timestamptz,

  CONSTRAINT networking_plan_jobs_status_known CHECK (
    status IN ('queued','rendering','uploading','awaiting_approval','approved','failed')
  ),
  -- A failure must say where it failed. A failed row with no stage is a row
  -- nobody can act on.
  CONSTRAINT networking_plan_jobs_failure_has_stage CHECK (
    (status <> 'failed') OR (failed_stage IS NOT NULL AND btrim(coalesce(failure_reason,'')) <> '')
  ),
  -- Approved means both halves of decision 4 happened.
  CONSTRAINT networking_plan_jobs_approved_is_complete CHECK (
    (status <> 'approved') OR (approved_at IS NOT NULL AND shared_at IS NOT NULL AND document_id IS NOT NULL)
  )
);

CREATE INDEX networking_plan_jobs_open_idx
  ON public.networking_plan_jobs (created_at)
  WHERE status NOT IN ('approved','failed');
```

**Three properties carried over from the ingest work, where their absence cost
real time:**

1. **Every job ends in a terminal state.** There is no path that leaves a row
   looking untouched. A silently abandoned job is indistinguishable from one
   nobody has started, and the queue then never drains while appearing healthy.
2. **`attempts` is recorded.** Without it a job that needed three tries looks
   exactly like one that needed one, and the real failure rate stays invisible.
3. **Failure is a distinct state from not-yet-run**, which is why the partial
   index excludes `failed` — a permanently failing job must not be re-served
   forever.

---

## 4. The pipeline

| Stage | Does | Writes on success | On failure |
|---|---|---|---|
| **1. Request** | Coach clicks *Generate networking plan*. Requires `drive_folder_id` set and `client_profile_id` non-null. | row `queued` | 400, no row |
| **2. Render** | Chromium loads the HTML, prints to PDF. | `status=rendering` → PDF in memory, `source_html_sha256` | `failed`, stage `render` |
| **3. Upload** | `files.create` into `drive_folder_id`, `supportsAllDrives: true`. | `drive_file_id`, `drive_file_url`, `status=uploading` | `failed`, stage `upload` |
| **4. Library** | Insert `coach_client_documents` with `visible_to_client = false`, `url = drive_file_url`. | `document_id`, `status=awaiting_approval` | `failed`, stage `library` |
| **5. Draft** | Compose subject + body. **Stored, not sent.** | `email_subject`, `email_body` | `failed`, stage `draft` |
| **6. Approve** | Coach reviews, clicks approve. Flip `visible_to_client=true` **and** grant the client viewer on the Drive file. | `approved_at`, `shared_at`, `status=approved` | stays `awaiting_approval`; see §5.3 |

Stage 6 is the only stage that touches the client. Everything before it is
invisible to them by construction, which is what decision 4 buys.

### Stage 2 notes — Chromium on Vercel

`puppeteer-core` + `@sparticuz/chromium`. Full `puppeteer` bundles a Chromium
download and will not deploy. Vercel functions now allow up to 5 GB package
size, so the binary fits, but **cold start is the real cost** — budget 3-8s
before the first byte renders. `maxDuration` caps at **800s on Pro**, which the
ingest routes already sit at; one PDF will not approach that, but a bulk
regenerate would, so keep it one job per invocation.

Render with `printBackground: true`, explicit `format: "Letter"` (or A4 — see
open questions), and wait on `networkidle0` plus `document.fonts.ready` if the
design uses a web font. A PDF that silently drops the brand font is the most
likely way "matching the approved design" fails.

### Stage 6 notes — the share

```
permissions.create(fileId, {
  role: "reader",
  type: "user",
  emailAddress: <client email>,
}, { supportsAllDrives: true, sendNotificationEmail: false })
```

`sendNotificationEmail: false` is **required by decision 2**. Google's own
notification would reach the client before the coach's email does, which is
exactly the thing the review step exists to prevent.

---

## 5. Recovery

Every stage is independently retryable because each writes its own artefact id
before advancing. Recovery means "re-run from the first stage whose artefact is
missing", not "start over".

### 5.1 Render fails
Nothing external happened. Safe to retry unconditionally. Increment `attempts`.
Persistent failure is almost always the HTML (missing asset, blocked font) and
not Chromium.

### 5.2 Upload fails after a successful render
No Drive file, no library row. Retry the upload.

**Risk: a retry that half-succeeded leaves an orphan PDF in the folder.** Drive
`files.create` is not idempotent. Mitigate by setting an
`appProperties.jobId = <job id>` on create, and on retry first
`files.list` the folder for `appProperties has { key='jobId' and value='<id>' }`;
adopt the existing file instead of creating a second one.

### 5.3 Library insert fails after a successful upload
The PDF exists in Drive but nothing references it. `drive_file_id` is already on
the job row, so the file is findable — this is a retry of stage 4 only, never a
re-render. **Do not delete the Drive file to "clean up"**; it is the expensive
artefact and it is already correct.

### 5.4 Approve half-fails — the important one
Decision 4 flips two things that live in different systems. They cannot be made
atomic. Order matters:

> **Share the Drive file first, then flip `visible_to_client`.**

If the share succeeds and the flip fails, the client has access to a PDF they
have not been told about and cannot see in the app — invisible, harmless, and
fixed by retrying the flip.

If the flip happened first and the share failed, the client sees a library entry
whose link returns *Request access*. That is a visible broken promise, and it
reaches the client at exactly the moment the coach has emailed them about it.

`shared_at` and `approved_at` are separate columns so this state is queryable:
`shared_at IS NOT NULL AND approved_at IS NULL` is the retry list.

### 5.5 Share rejected by Workspace policy
If the Shared Drive or the Workspace forbids external sharing, `permissions.create`
fails with `403 sharingRateLimitExceeded` or a domain-policy error. This is a
configuration failure, not a transient one — **do not retry it**, surface it to
the coach as "your Workspace is blocking external sharing". Untested; see open
questions.

### 5.6 Wrong folder
Worst case, and the reason for the §3.1 validation. If a plan lands in the wrong
client's folder: revoke the client permission on the file, move the file
(`files.update` with `addParents`/`removeParents`), soft-delete the library row
(`deleted_at`), and correct `drive_folder_id`. The job row keeps the history.

---

## 6. Open questions

Flagged rather than assumed. Each changes what gets built.

1. **Which email is "the client's email"?** `coach_clients.invited_email` and
   `client_profiles.email` both exist and can differ. Sharing with the wrong one
   silently grants access to someone else.
2. **Prospects are out of scope by construction.** The existing documents route
   rejects a relationship with no `client_profile_id` (*"a prospect with no
   linked profile can't hold library docs yet"*). Confirm that is acceptable, or
   the library table's denormalised non-null column has to change first.
3. **Which Shared Drive, and is the service account a member of it?** The
   service account needs at least Content manager on the drive. Not yet created.
4. **Letter or A4**, and does the approved design assume a page size?
5. **The HTML is not yet in the repo.** Everything in §4 stage 2 is contingent
   on it. Where should it live — a template file, or a column?
6. **Does the coach edit the drafted email before sending?** If yes, the edited
   text should be what gets stored, otherwise `email_body` is a record of
   something that was never sent.
7. **Regeneration.** If a plan is generated twice for one client: new Drive file
   and new library row, or replace in place? Affects whether `coach_client_id`
   wants a uniqueness constraint.

---

## 7. What was checked, and what was not

**Checked against prod / the repo on 2026-09-22:** the `coach_clients` and
`coach_client_documents` schemas and row counts; the absence of `drive_folder_id`;
the absence of any job table; the absence of any PDF, Chromium or Google
dependency; the absence of any Networking Plan reference; the existing documents
route's auth guards and its `visible_to_client` default; `vercel.json` crons and
the 800s `maxDuration` ceiling already in use.

**Not verified, stated from general knowledge and flagged as such:** service
account Shared Drive quota behaviour; `@sparticuz/chromium` cold-start figures;
Drive API error codes for blocked external sharing; the 5 GB function package
limit. All four should be confirmed against a spike before the estimate hardens.
