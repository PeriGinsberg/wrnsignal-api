# Coach-run contacts import

Loads the **Contacts** tab of a client networking workbook (Company, First Name,
Last Name, Title, Email, LinkedIn, Domain) into a client's board, run by the
coach.

Companion to `network-tracker-import.md`, which describes the original
client-run importer. This document covers only what changes.

## The owner-only reversal, stated plainly

The two import routes were owner-only **by design**, and said so:

> Owner-only by design; resolveOwnerScope never consults the query string, so
> this cannot widen into coach access by accident.
> `app/api/network/import/commit/route.ts:29`

`lib/collab/scope.ts` gave the reasoning: routing these through
`resolveRequestScope` "would have quietly granted coaches write access to the
pipeline the first time one appended `?client_profile_id=`".

`NetworkLanding.tsx` therefore **hid** the Import button from coaches, because a
coach pressing it would have imported the client's contacts onto the coach's own
board.

This change reverses that decision for import, deliberately and with the product
asking for it. Both import routes now use
`resolveRequestScope(req, supabase, { require: "write" })`.

Three things make the reversal safe rather than accidental:

1. `REQUIRED.write` is already `full`, so `view` and `annotate` coaches get a 403
   without any new logic.
2. The board written to is the branded `scope.subjectId`, never a raw id off the
   request.
3. The coach is shown the client's name on every step and must confirm that name
   before anything is written.

**The reversal is scoped to import.** Delete, reminders, and
`companies/link-application` stay owner-only.

## Which tab

`Contacts` is auto-selected when a sheet by that name exists (case-insensitive).
Otherwise the coach picks, exactly as before. The workbook's other tab
(`Outreach Messages`) is ignored: no templates, no messages, no action rows.

## Company resolution

In order:

1. **Domain**, normalized: lowercased, scheme and `www.` and any path stripped,
   trailing dot removed. Free-mail domains (gmail, outlook, yahoo, icloud,
   hotmail, proton, aol, gmx, mail.com) are **ignored for matching**, so a
   personal address never merges two employers.
2. **Name**, case-insensitive, which is what the existing
   `uq_network_companies_name` index enforces.
3. Otherwise create, carrying the domain.

Two cases that are not a match and not a create:

- **Domain with no Company cell → `skip_invalid`.** A domain alone would mean
  inventing a display name from a hostname. The row is reported, not guessed at.
- **Domain points at one company and name at another → `skip_conflict`.** Both
  are plausible identities and the engine has no basis to choose.

**Domain backfill.** When a row matches an existing company by name and that
company has no domain, the domain is written. This is the one write to an
existing row the import performs, and the preview reports it as its own line so
it is never silent.

## Contact resolution

In order:

1. **Email**, when present and valid, compared case-insensitively across the
   whole board.
2. Otherwise **name plus resolved company**, matching the two partial unique
   indexes (`uq_network_contacts_at_company`, `uq_network_contacts_standalone`).

Notes:

- Neither email nor domain has a unique index, so both are resolved in
  application code against a batch pre-fetch. `23505` is still caught per row on
  insert and recorded as a skip.
- An email matching a contact **at a different company** is still a duplicate
  (the person changed jobs); the preview labels it distinctly.
- A non-address in the Email cell (`"call her"`, a phone number) leaves `email`
  null, still creates the contact, and is reported. Unlike the client-run
  importer, it does **not** write a `note_logged` action: this path creates no
  action rows at all.

## Defaults on create

| Field | Value |
|---|---|
| `relationship` | `cold` |
| `stage` | not set, so the column default `identified` applies |
| `priority` | null |
| `segment` | null |
| `source` | `import` |
| `created_by_role` / `created_by_id` | from the scope, so a coach-run import records `coach` |

**Existing contacts are never updated.** Every match is a skip.

## Dispositions

| Disposition | Meaning |
|---|---|
| `create` | New contact |
| `skip_duplicate_email` | Email already on the board |
| `skip_duplicate_name` | Same name at the same company |
| `skip_conflict` | Domain and name resolve to different companies |
| `skip_invalid` | No usable name, or a domain with no company |

`emailDropped` is a flag on a `create`, not a disposition.

## The two endpoints

**`POST /api/network/import/preview`** keeps parsing and mapping-guessing, and
gains a resolve phase when a mapping is posted. It is strictly read-only and
returns the subject's id and name alongside the dispositions, so the name shown
in the UI comes from the same scope that authorized the write.

**`POST /api/network/import/commit`** re-parses the re-uploaded file and
**re-resolves from scratch**. The preview is advisory; the database at commit
time decides. Order of writes: create companies, backfill domains, insert
contacts in chunks.

There is no multi-row transaction, so a partial import is possible. Because
every rule is a skip rather than an update, **re-running the same file is safe**,
which is the property that matters more than rollback.

## Confirm before commit

A coach must confirm the client's name in a dedicated step. The name is the one
the server returned for the authorized subject, not one held in the page's
state. An owner importing their own board does not see this step.

## Files

| File | Change |
|---|---|
| `lib/network-tracker/import-resolve.ts` | New. Pure resolution: rows plus existing state in, dispositions and plans out. |
| `lib/network-tracker/company.ts` | `matchOrCreateCompany` accepts a domain to set on create. |
| `app/api/network/import/preview/route.ts` | Scope switch, Contacts-tab preference, resolve phase, subject name. |
| `app/api/network/import/commit/route.ts` | Scope switch, new resolution, domain backfill, no action rows. |
| `app/dashboard/network/import/page.tsx` | Client banner on every step, confirm step, disposition table. |
| `app/dashboard/network/NetworkLanding.tsx` | Show Import to coaches; replace the comment that says why it was hidden. |

## Testing

`import-resolve.test.ts` covers every disposition, domain normalization
(including `www.`, paths, and free-mail rejection), email case-insensitivity,
the conflict case, and within-batch duplicates.

Authz has two layers, because they answer different questions.

`lib/collab/scope.test.ts` proves the **ladder** with a fake PostgREST client:
no row, a stranger's row, and `pending` / `paused` / `revoked` all throw, and
`annotate` does not satisfy a write.

`tests/network-tracker/import-authz.live.ts` proves the **import routes stand on
it**, by making real requests to a running API. A route that resolved the
subject but forgot `require: "write"` would pass the first test and fail this
one. It covers an unlinked coach, `pending`, `revoked`, `paused`, `annotate`,
`view`, and both confirmation failures, with a `full` preview as the control so
a broken setup cannot masquerade as a refusal. It carries its own one-row CSV
rather than a fixture, so it holds no real contact data; it rewrites the
coach_clients row to drive the states and restores it in a `finally`; and it
asserts the board's contact count is identical afterwards. Dev only, and it
refuses to run against the production project. Env-driven:

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
API_BASE=http://localhost:3000 \
COACH_LINKED=coach@x.com COACH_UNLINKED=other-coach@x.com CLIENT_EMAIL=client@x.com \
npx tsx tests/network-tracker/import-authz.live.ts
```

Fixture: `network-import-fixtures/Noah_Sperling_Contact_List.xlsx` (27 rows,
tabs `Contacts` and `Outreach Messages`). The fixtures directory is gitignored
because it holds real contact lists.

## Scope

Dev only. No promotion until the preview output has been reviewed.
