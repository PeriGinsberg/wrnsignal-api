# Network Tracker — Import Spec (Phase 6)

Add to `docs/network-tracker/` as `IMPORT.md`. Replaces the import mapping section of
`network-tracker-data-model.md`, which assumed a fixed header contract.

**Why this changed.** The contract assumed files arrive in our shape. A real client list
(Maleri's Boston soft-IP hit list: 48 contacts, 6 firms) matched none of it — one Name
column instead of two, headers on row 4, a non-person row, eight contacts sharing one firm
inbox, and no column name in common with ours. Lists will keep arriving from WRN pulls,
ChatGPT, LinkedIn exports, and other people's spreadsheets. Requiring the user to reformat
is friction at the exact moment they're most motivated.

**So: we map, they confirm.** Upload → we guess → preview → import.

---

## 1. Accept both CSV and XLSX

Real lists arrive as `.xlsx` far more often than `.csv`. Requiring an export step is
avoidable friction.

**Parsers (decided — corrected after a real file).** SheetJS is NOT installed (an earlier
draft claimed it was). We first chose **`exceljs`**, but it **failed on the first real file**
(Maleri's list): it assumes an unprefixed default XML namespace, and that workbook is
namespace-prefixed (`<x:workbook>`, `<x:sheet>`, GUID relationship IDs, inline strings — a
tool/SDK-generated file, exactly the "from anywhere" class this feature targets). exceljs threw
`Cannot read properties of undefined (reading 'sheets')` deep in its loader, and patching one
gap only revealed the next. A hand-rolled parser would inherit that same treadmill.

**We use `read-excel-file` for `.xlsx` and `papaparse` for `.csv`** — both npm, MIT,
maintained (no non-registry lockfile entry to break a Vercel clean install; SheetJS's fixed
build is CDN-only + its npm build carries CVEs). `read-excel-file` parses the prefixed-namespace
file cleanly: all sheets, leading title/blank rows preserved (so header detection still works),
typed cells, entities and accents intact. Parsing runs **server-side** in the import route,
reusing SIGNAL's existing upload plumbing: the `/api/resume-upload` pattern —
`multipart/form-data` → `req.formData()` → `file.arrayBuffer()` → `Buffer` (nodejs runtime,
`resolveCaller` owner-gate). Regression fixtures live in the git-ignored
`network-import-fixtures/` and are exercised by `tests/network-tracker/import-parse.test.ts`.

If the workbook has multiple sheets, ask which one — Maleri's file has three, and only the
first holds contacts.

**Row cap.** Reject files above **~1,000 data rows** with a clear message rather than choking
(the preview round-trips parsed rows to the client; huge files mean huge JSON). Real lists are
20–200 rows.

## 2. Find the header row; don't assume row 1

Her headers sit on row 4, under a title and a paragraph of instructions. Scan the first ~10
rows and pick the one that looks most like headers: most non-empty cells, mostly short text,
no long sentences, and followed by rows with a similar fill pattern. Show the user which row
was chosen and let them override.

## 3. Guess the column mapping, then let the user fix it

Match on normalised header text (lowercase, strip punctuation and spacing) against a synonym
list. Everything below is a starting set, not exhaustive:

| Our field | Matches |
|---|---|
| `name` (combined) | name, contact, contact name, full name, person |
| `first_name` | first, first name, fname, given name |
| `last_name` | last, last name, lname, surname, family name |
| `company` | company, firm, employer, organisation, organization, account |
| `title` | title, job title, role, position |
| `email` | email, e-mail, email address, contact method |
| `linkedin_url` | linkedin, linkedin url, li, profile |
| `company_domain` | domain, website, url, company url |
| `segment` | segment, list, source list, category |
| `priority` | priority, rank, tier |
| `relationship` | relationship, type, connection, warmth |
| `additional_info` | personalization, personalisation, opener, hook, why, angle, additional info, notes about |

The preview screen shows each source column, the field we mapped it to, and three sample
values. Every mapping is a dropdown the user can change, including "don't import."

**Unmapped columns are dropped silently.** Her file has Firm Type, Verification, Est.
Response Likelihood, Practice Fit, Why This Contact, Source URL, Status, Date Sent,
Follow-Up Date, Response/Notes. None have a home, and inventing fields for them is how the
schema rots.

## 4. Splitting one name column into two

Confirmed: split automatically.

Rules, in order:
1. Strip a leading title (Dr., Mr., Ms., Mrs., Prof.).
2. Strip and retain a trailing suffix (Jr., Sr., II, III, IV, Esq., PhD, JD).
3. Everything after the **last** space is `last_name`. Everything before is `first_name`.
4. Preserve everything else verbatim — accents, apostrophes, hyphens. `John L. DuPré`,
   `Ann M. O'Rourke`, and `Giovanna H. Fessenden-Fairbank` must survive intact. Do not
   ASCII-fold, title-case, or otherwise "clean" a person's name.

Middle initials stay in `first_name` (`Amanda E.` / `Schreyer`). That's fine — nothing keys
on first name alone, and the display joins them anyway.

**Two encoded rules (approved):**
- A **single-token** name → all of it in `last_name`, `first_name: ''` (matches the §5
  non-person shape and renders fine once the display join is trimmed).
- A **trailing suffix** → appended to `last_name` (`Smith Jr.`), not dropped.

**The splitter is a pure function with its own unit tests** (`lib/network-tracker/`), like the
reminder engine — it's the step most likely to be quietly wrong, so it's tested in isolation
against the §4 examples (`John L. DuPré`, `Ann M. O'Rourke`, `Giovanna H. Fessenden-Fairbank`,
titles, suffixes, single-token, blank).

**Show the split in the preview.** Two columns, before and after, for the first ten rows.
This is the step most likely to be subtly wrong on any given list, and it's cheap to eyeball.

## 5. Rows that aren't people

Confirmed: import with a blank name rather than reject.

`network_contacts.first_name` and `last_name` are both `NOT NULL`, so "blank" needs a
concrete shape. Put the raw text in `last_name` and leave `first_name` as an empty string:

- `Trademark Team` → `first_name: ''`, `last_name: 'Trademark Team'`

The display name is `first_name + ' ' + last_name`, trimmed, so it renders as
"Trademark Team". Dedup still works. No schema change.

Flag these in the preview — "this doesn't look like a person's name" — so the user can
change the mapping or drop the row, but default to importing.

## 6. Email is not unique and is not always an email

Eight of her contacts share `Inquiry@LALaw.com`; several more share `info@gesmer.com`. One
cell reads *use firm contact form / 617-439-3200*.

- **Never dedup on email.** Dedup stays name + company, as built.
- If a cell doesn't parse as an email address, leave `email` null and keep the raw text —
  see §8. Do not import "Use firm contact form / 617-439-3200" into an email field.

## 7. Fields we deliberately leave blank

Confirmed with the Coach:

- **`priority`** — blank. Her Outreach Rank and two 1-5 ratings are her own scoring system;
  mapping them to A/B/C would be a guess dressed as data. If a file has a column that's
  literally A/B/C, map it.
- **`relationship`** — blank. Nothing in her file states it, and everything in it is cold —
  but inferring that is the kind of assumption that quietly breaks the template choice. It
  surfaces in the dashboard's "needs attention" as contacts with no relationship set, which
  is the right place to fix it.
- **`segment`** — blank unless a column maps.
- Everything tracker-owned stays untouched: `stage`, all dates, actions, reminders,
  `cycle_started_at`, the three milestone timestamps, company `tier` and `status`.

## 8. Two fields worth adding

**`additional_info` (text) on `network_contacts` — ADDED (migration 4,
`20260724_network_additional_info.sql`).** Agreed name is `additional_info` (this section
originally proposed it as `personalization`).

Her "Personalization Sentence" column is a written-per-contact opening line:

> *I was drawn to your practice at the intersection of content licensing, marketing and
> advertising, trademark protection, and doing business online.*

That is the single most valuable column in the file and there is nowhere to put it. It also
fits the template system exactly: the template supplies structure, this supplies the line
that makes it not-a-form-letter. Stored as `additional_info` (detail-page only, never a
spreadsheet column), exposed as the `[ADDITIONAL_INFO]` merge variable in Phase 8, and it
drops straight into C1.

**`contact_method` — DECIDED: no column.**

Where the email cell isn't an email ("use firm contact form / 617-439-3200"), the
information is still useful and currently gets thrown away. **Decision: no new field.** Append
the raw non-email text as a **`note_logged` action with `author_role: 'system'`**, so it lands
as a dated entry in the contact's timeline (visible where a user actually looks) rather than
hiding in a column. No migration.

## 9. Company handling

- Match existing companies case-insensitively via `uq_network_companies_name`; create if new.
- New companies land with blank `tier` and `status`, as locked.
- Blank company → standalone contact.
- Her file has no domain column, but source URLs contain them. **Don't parse domains out of
  arbitrary URLs** — `wolfgreenfield.com/cafc/author/chris-henry` is a company domain,
  `morse.law/industry/fintech/` is a practice page. Map `company_domain` only from a column
  that is actually a domain or company URL.

## 10. Dedup and the result summary

Dedup unchanged: `onConflict` on `uq_network_contacts_at_company` (company-attached) or
`uq_network_contacts_standalone` (standalone). Skip existing, never overwrite.

On completion, show counts and let the user see the detail:

- Imported: N contacts across M companies (K new companies created)
- Skipped as duplicates: N, each named
- Skipped for no name: N, with row numbers
- Flagged but imported: non-person names, unparseable emails
- Fields left blank by design: relationship, priority, segment

Then link straight into the Contacts view. **No import-batch marker** (decided): a fresh
import lands entirely as `identified` / no-activity, which the default no-activity-first sort
already clusters at the top — so the just-imported rows are the first thing shown, without a
batch column. Dropping someone back on an unchanged screen after a 48-row import is the same
"nothing showed" problem the roster fixed.

## 11. What this is NOT

- No inferring relationship, priority, or stage from anything.
- No creating fields on the fly for unmapped columns.
- No overwriting existing contacts. Ever.
- No partial-row repair. A row missing a name is skipped and reported, not guessed at.
