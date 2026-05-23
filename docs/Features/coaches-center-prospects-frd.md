# FRD: Coaches Center — Prospects (v0.1)

**Feature ID:** [Assigned by Peri]
**Category:** Coaches Center
**Release:** Prospects v0.1
**Status:** Draft — awaiting Peri approval
**Author:** Peri Ginsberg + Claude (design conversation 2026-05-22)
**Date:** 2026-05-22

**Depends on:** coach_clients lifecycle_status (shipped 2026-05-21), coach_client_notes typed-notes table (shipped 2026-05-09), existing coach create-client + invite flows

---

## 1. Context and motivation

A coach's actual workflow has a sales funnel that exists *before* SIGNAL account creation: leads, prospects, discovery calls, proposals, contracts, payment. Today SIGNAL collapses this entire funnel into a single binary event — "create client account" — which creates an auth user, a `client_profiles` row, and a `coach_clients` link in one shot.

This is wrong for how coaches actually work. A coach who's just met someone at a networking event shouldn't have to create a SIGNAL account to capture them. A coach who's mid-sales-conversation shouldn't have to commit to platform onboarding before the prospect has paid. The current model forces coaches to either (a) prematurely create SIGNAL accounts for people who may never convert, polluting their client list, or (b) keep prospects in a separate tool (spreadsheet, notebook, generic CRM) and lose the integration entirely.

The `Prospect` lifecycle_status value already exists on `coach_clients` (added 2026-05-21), but no functionality is wired to it. Today, every `coach_clients` row in production was created via the full SIGNAL-invite path. The Prospect status is descriptive but not actionable — there is no way to *capture* a Prospect without creating a full SIGNAL account.

**Core principle: Prospect work and Client work are different modes of work.**

Prospect work is sales pipeline management — capturing leads, tracking source attribution, advancing through phases (initial contact → discovery → proposal → signed → paid). Client work is service delivery — managing job search, recommending opportunities, reviewing applications. These are different daily workflows that deserve different surfaces.

**Conversion is manual and coach-defined.**

Every coach handles conversion differently. Some charge up front; some begin work before payment; some have different criteria entirely. The transition from Prospect → Client is therefore a manual decision by the coach, never automatic. The phase checkboxes describe activity (what's been done), not state (what the coach has classified the relationship as). Lifecycle_status is the coach's classification, independent of any specific phase being checked.

**SIGNAL invite is decoupled from conversion.**

A Client can exist indefinitely without a SIGNAL account. A coach may convert a prospect to client but continue working off-platform initially — uploading the resume later, sending the invite when ready, or never sending it at all. The "Send SIGNAL invite" action is a separate explicit step from the Prospect → Client status change.

---

## 2. Goals and non-goals

### Goals

1. Enable coaches to capture Prospects without creating SIGNAL accounts
2. Capture source attribution (referral / social_media / website / personal_contact / other + free-text detail) for prospect analytics
3. Track 7 sales-pipeline phases via flexible checklist (Initial Contact Made → Discovery Call Scheduled → Discovery Call Completed → SOW Sent → SOW Signed → Invoice Sent → Invoice Paid)
4. Support notes on Prospects (same notes feed as clients, attached via coach_client_id)
5. Manual conversion Prospect → Client via status change
6. Separate "Send SIGNAL invite" action available only on Client records without a linked profile
7. Prospect history (phase timestamps) visible as collapsed read-only block on Client detail pages after conversion
8. Dedicated `/dashboard/coach/prospects` top-level tab — separate workflow surface from `/dashboard/coach/clients`
9. v0.1 ship target: capture, edit, convert, send-invite, all end-to-end functional in dev

### Non-goals (v0.1)

- Phase analytics ("avg days from initial contact to SOW signed", "conversion rate by source") — deferred until usage patterns inform what's worth measuring
- Source attribution dashboards — same deferral logic as phase analytics
- Bulk import (CSV) — coach capture is one-at-a-time in v0.1
- Reminders / follow-up dates / next-action fields — separate scope; tracked as deferred work
- Custom phase definitions per coach — phase list is locked at the 7 values for v0.1; revisit after beta feedback
- Multiple coaches sharing a Prospect — each coach has their own prospect pipeline; two coaches can independently prospect the same person without collision
- Auto-conversion triggered by checking "Invoice Paid" or any other phase — conversion is always manual
- Coach-side intervention UI for prospect-stage SIGNAL features — Prospects have no SIGNAL features
- D2C self-serve prospect capture (e.g., website lead-capture forms) — coach-side only in v0.1
- Auto-derivation of source category from referral context — coach selects manually
- Email validation or normalization on prospect rows — invited_email is free-form text in v0.1

---

## 3. Scope

This FRD covers:

1. **Schema migration** — additive columns on `coach_clients` (name, source_category, source_detail, 7 phase booleans + 7 phase timestamps); nullability change on `coach_clients.invited_email`; nullability change on `coach_client_notes.client_profile_id`
2. **Five new API endpoints under `/api/coach/prospects/*` and `/api/coach/coach-clients/[id]/send-invite`**
3. **Existing API refactors** — all 5 `coach_client_notes` routes switch read filters to `coach_client_id`; `/api/coach/home` NULL hardening (5 specific edit points); `runHeuristics` invocation filters prospects out
4. **Frontend** — new `/dashboard/coach/prospects` list page; new `/dashboard/coach/prospects/[id]` detail page; "+ Add Prospect" capture modal; `LifecycleStatusPill` context-aware refactor; nav addition; Client detail page additions (Prospect history block + Send SIGNAL invite button)
5. **End-to-end functional in dev** as the v0.1 ship boundary

All deliverables ship to dev environment first. Production promotion is a separate explicit step requiring Peri approval. Beta coaches will be invited in dev for early feedback before production rollout.

---

## 4. Design principles

### 4.1 Lifecycle: Prospect is a coach-managed classification, not a system-derived state

The 4-value lifecycle (`Prospect → Active → Inactive → Archived`) reflects the coach's mental model of where each person sits in their book of business. The coach manually advances status. The system never auto-promotes based on phase checkboxes, payment events, SIGNAL invite acceptance, or any other signal.

This preserves coach methodology variance. Some coaches require contract-signed-and-paid to call someone a Client; others convert at SOW Signed; others convert after the discovery call when they've decided to engage. The system shouldn't prescribe.

**Terminology note (literal vs colloquial):** The 4 lifecycle values per the DB CHECK constraint are `Prospect`, `Active`, `Inactive`, `Archived`. Throughout this doc and in coach-facing UI labels (e.g. the "Convert to Client" button), the `'Active'` value is referred to colloquially as "Client" — meaning a coach has converted a prospect into an actively-coached client. The underlying DB value remains `'Active'`. Backend code, API payloads (request and response), TypeScript types, validation rules, and DB-level checks all use the literal `'Active'` string. When this doc reads "Client" outside a code block, it means "Active-status client" colloquially; inside code blocks the literal `'Active'` is canonical.

### 4.2 SIGNAL invite is decoupled from conversion

A Client exists when the coach says so. A SIGNAL account exists when the coach explicitly sends an invite. These are independent decisions.

A Client without a SIGNAL account is a valid steady state — the coach is doing the engagement off-platform, the client isn't ready for the platform yet, or the coach simply hasn't sent the invite. The Client detail UI must degrade gracefully for this state: notes and profile work, SIGNAL-dependent features (Job Tracker, Personas, Applications) are unavailable until the invite is sent.

### 4.3 Prospect data is lightweight; capture is fast

The minimum capture cost is three fields: name, source_category, and coach ownership (always set by the auth context). Everything else is optional — email, source detail, phase checkboxes, notes. The 10-second capture at a networking event is a first-class use case.

Adding fields beyond the locked v0.1 set is deferred until beta coaches reveal what they actually need. Speculative fields hurt adoption.

### 4.4 Phases are activity tracking, not state machines

The 7 phases are a flexible checklist. The coach can check them in any order, leave gaps, uncheck and recheck. No ordering is enforced. The UI presents them in the typical-flow order for visual clarity, but the schema doesn't require sequence.

Phase timestamps are auto-recorded when a phase is checked, providing a free analytics signal without burdening the coach with explicit date entry. After conversion, the timestamps become a read-only "Prospect history" record on the Client detail page.

### 4.5 No filler features

This FRD ships *only* what's needed to make Prospect capture-and-convert work end-to-end. Analytics, dashboards, reminders, custom workflows, source-detail autocomplete — all deferred. The risk in CRM-as-a-feature is building a half-CRM that's worse than the coach's existing spreadsheet. v0.1 must be ruthlessly narrow.

### 4.6 No shell profiles

A Prospect is a `coach_clients` row with `client_profile_id IS NULL`. No `client_profiles` row is created at prospect capture time. This:

- Avoids the global UNIQUE constraint on `client_profiles.email` (two coaches can independently prospect the same person)
- Prevents pollution of downstream queries that count "real" clients
- Establishes the conversion-with-invite step as the clean architectural seam where profile creation happens

---

## 5. User flow

### 5.1 Entry

Coach accesses Prospects via:
1. New nav item "Prospects" in the COACHES CENTER nav group (alongside Dashboard, Required Actions, My Clients)
2. The existing "Active Prospects" tile on Coach Home (currently routes to `/dashboard/coach/clients?filter=prospect`; the tile destination is updated to `/dashboard/coach/prospects` in this release for consistency)

### 5.2 Prospects list view (`/dashboard/coach/prospects`)

Shows all `coach_clients` rows for the current coach where `lifecycle_status = 'Prospect'`. Each row displays:
- Name
- Source category (icon or label)
- Phase progress indicator (e.g., "3 / 7 phases complete" or a small dot row)
- Last activity timestamp (most recent phase check or note added)
- LifecycleStatusPill (allows direct status change without entering detail view)
- Click-through to detail view

Sort order: most recent activity first (default). No filter UI in v0.1; the list is already scoped to Prospects by definition.

Empty state: "No prospects yet. Click + Add Prospect to capture your first lead."

"+ Add Prospect" button in the header opens the capture modal.

### 5.3 Add Prospect modal

Light form with three required fields and several optional ones:

**Required:**
- Name (free text, min 1 character)
- Source category (radio buttons / select: Referral, Social Media, Website, Personal Contact, Other)

**Optional:**
- Email (free text; not validated in v0.1)
- Source detail (free text; e.g., "mom", "LinkedIn post on Q4 hiring", "BU alumni event")
- Initial note (free text; optional first note attached to the new prospect)

Phase checkboxes are NOT in the capture modal — they're set in detail view. The capture is intentionally minimal.

On submit:
- POST `/api/coach/prospects` with the form payload
- On success: modal closes, list refreshes, optionally navigates directly to the new prospect's detail view

### 5.4 Prospect detail view (`/dashboard/coach/prospects/[id]`)

Where `[id]` is the `coach_clients.id`.

Sections (top to bottom):
- **Header:** name (editable inline), LifecycleStatusPill, "Convert to Client" button (functionally equivalent to setting LifecycleStatusPill to Client, but more discoverable)
- **Contact:** email (editable inline)
- **Source attribution:** source_category (editable), source_detail (editable)
- **Phase checkboxes:** 7 checkboxes in visual order, each with the phase label and (when checked) the timestamp of when it was checked
- **Notes feed:** existing notes component, scoped to this `coach_clients.id`. Add-note input at top, list of notes below.

Inline edits debounce and PATCH to `/api/coach/prospects/[id]`. No save button.

### 5.5 Conversion (Prospect → Client)

Coach clicks "Convert to Client" (or changes the LifecycleStatusPill to Client). The system:

1. PATCHes `/api/coach/prospects/[id]` with `{ lifecycle_status: "Active" }`
2. The row's lifecycle_status changes; nothing else changes
3. Frontend redirects to `/dashboard/coach/clients/[clientId]` — but wait: the existing client detail route expects `client_profile_id` in the URL, and this row has none

This is the architectural seam. Two options:

**Option (a):** Redirect to `/dashboard/coach/prospects/[id]` (stay on the prospect-shaped detail page even after conversion). The page conditionally shows different actions based on lifecycle_status. Awkward URL ("prospects" for a Client) but no routing change needed.

**Option (b):** Build a new client-shaped detail route keyed by `coach_clients.id` that handles the no-profile case. Coach lands on a client detail page with most tabs disabled and a prominent "Send SIGNAL invite" button.

**Recommended v0.1: Option (b).** The post-conversion experience should feel like client management, not prospect management. The new client-shaped detail route is a v0.1 deliverable.

After conversion, the row no longer appears in the Prospects list (filter excludes non-Prospect lifecycle_status). It appears in the My Clients list with a "No SIGNAL account" indicator until the invite is sent.

### 5.6 Send SIGNAL invite (Client without profile)

Available on Client records where `client_profile_id IS NULL`. The button does what `app/api/coach/create-client/route.ts` does today, but instead of creating a new `coach_clients` row, it updates the existing one:

1. Validates email is present on the row (required for invite)
2. Creates auth user via `supabase.auth.admin.createUser`
3. INSERTs `client_profiles` row with the captured name + email + (any other fields the coach has filled in)
4. UPDATEs the existing `coach_clients` row to set `client_profile_id`
5. Optionally creates `client_personas` row if resume_text is present
6. Sends magic link

After invite is sent, the Client detail page transitions to the full client experience — Job Tracker, Personas, Applications tabs all become available.

### 5.7 Prospect history on Client detail

After conversion, the phase checkboxes are no longer the primary editable surface. They remain on the row in the database. The Client detail page shows them as a collapsed "Prospect history" block:

```
Prospect history (expand)
  ✓ Initial Contact Made — Mar 3, 2026
  ✓ Discovery Call Scheduled — Mar 8, 2026
  ✓ Discovery Call Completed — Mar 15, 2026
  ✓ SOW Sent — Mar 22, 2026
  ✓ SOW Signed — Mar 28, 2026
  ✓ Invoice Sent — Mar 28, 2026
  ✓ Invoice Paid — Apr 2, 2026
```

Collapsed by default. Expandable. Read-only — coach cannot uncheck phases from the Client detail page (would need to revert lifecycle_status to Prospect first, which is acceptable but uncommon).

If no phases were checked before conversion (e.g., the coach skipped phase tracking), the Prospect history block is hidden entirely.

---

## 6. Technical design

### 6.1 Schema migration

Single migration file: `supabase/migrations/20260522_prospects_v0_1.sql`.

```sql
-- Add prospect-specific columns to coach_clients
ALTER TABLE coach_clients
  ADD COLUMN name text,
  ADD COLUMN source_category text
    CHECK (source_category IS NULL OR source_category IN
      ('referral','social_media','website','personal_contact','other')),
  ADD COLUMN source_detail text,
  ADD COLUMN phase_initial_contact_made boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_initial_contact_made_at timestamptz,
  ADD COLUMN phase_discovery_call_scheduled boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_discovery_call_scheduled_at timestamptz,
  ADD COLUMN phase_discovery_call_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_discovery_call_completed_at timestamptz,
  ADD COLUMN phase_sow_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_sow_sent_at timestamptz,
  ADD COLUMN phase_sow_signed boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_sow_signed_at timestamptz,
  ADD COLUMN phase_invoice_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_invoice_sent_at timestamptz,
  ADD COLUMN phase_invoice_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN phase_invoice_paid_at timestamptz;

-- Relax invited_email NOT NULL for prospect rows captured without email
ALTER TABLE coach_clients
  ALTER COLUMN invited_email DROP NOT NULL;

-- Relax coach_client_notes.client_profile_id NOT NULL for prospect notes
ALTER TABLE coach_client_notes
  ALTER COLUMN client_profile_id DROP NOT NULL;

-- Index to support the prospects list query
CREATE INDEX IF NOT EXISTS idx_coach_clients_prospect_list
  ON coach_clients (coach_profile_id, lifecycle_status)
  WHERE lifecycle_status = 'Prospect';
```

Applies to dev via Supabase SQL Editor (per Foundation Risk 6 pattern). Production promotion is a separate explicit step requiring Peri approval.

Notes:
- All new columns are nullable or have `NOT NULL DEFAULT false` so existing rows are unaffected
- The CHECK constraint on `source_category` allows NULL so existing rows don't need backfill
- The partial index on `lifecycle_status = 'Prospect'` keeps the index small and supports the most common new query
- No backfill of existing data is needed; existing Client rows simply have NULL source/name (the name is already in `client_profiles.name` for those rows)

### 6.2 Notes refactor (canonicalize on coach_client_id)

`coach_client_notes.coach_client_id` is already populated on every existing row (verified: 14 rows in dev, zero NULLs). The refactor changes 5 routes to query by `coach_client_id` instead of `(coach_profile_id, client_profile_id)`:

| Route | Change |
|---|---|
| GET `/api/coach/clients/[clientId]/note-feed` | `.eq("coach_client_id", coachClientId)` instead of `.eq("client_profile_id", clientProfileId)` |
| POST `/api/coach/clients/[clientId]/note-feed` | No change to INSERT (already writes coach_client_id); read-back uses new filter |
| PUT `/api/coach/clients/[clientId]/note-feed/[noteId]` | Verify ownership by coach_client_id, not client_profile_id |
| DELETE `/api/coach/clients/[clientId]/note-feed/[noteId]` | Same |
| GET `/api/coach/clients/[clientId]/needs-attention` | Filter by coach_client_id |
| GET `/api/coach/action-items` | Filter by coach_profile_id only (already coach-scoped, no client-scope filter needed) |

The `[clientId]` URL param semantics remain the same for these routes (still `client_profile_id`). Each route's handler first resolves `coach_client_id` from `(coach_profile_id, client_profile_id)`, then uses `coach_client_id` for the notes query. This is a minor refactor — adds one lookup hop, but the path is already coach-scoped.

For prospect notes, a NEW set of routes mounted under the prospects path handles the same operations keyed directly by `coach_clients.id`. See §6.5.

### 6.3 /api/coach/home NULL hardening

Five specific edit points in `app/api/coach/home/route.ts`:

| Line | Current | Change |
|---|---|---|
| 163 | `const cpid = rel.client_profile_id as string` | Allow null; skip per-client stats queries when null |
| 236 | `client_profile_id: cpid` in returned card | Update return type to `string \| null` |
| 272 | `client_profile_id: c.client_profile_id` in heuristic input | Filter out prospects before constructing heuristicClients |
| 320 | `aiProfileIds.push(c.client_profile_id)` | Already gated by lifecycle_status; add defensive null filter |
| 324 | `aiaProfileIds.push(c.client_profile_id)` | Same |

The `heuristicClients` filter at line 271-277 changes to:
```typescript
const heuristicClients: HeuristicClient[] = clientCards
  .filter((c) => c.client_profile_id !== null && c._user_id !== null)
  .map((c) => ({ /* unchanged */ }))
```

This eliminates the `r1:null` signal-id bug surfaced in the round 3 investigation.

### 6.4 API endpoints — Prospects

All new endpoints use the existing coach auth pattern (admin client + bearer token + `getProfileId` + `is_coach` check). All endpoints are keyed by `coach_clients.id` (referred to as `prospectId` in URL params for clarity).

#### 6.4.1 GET /api/coach/prospects

List prospects for the current coach.

```typescript
// Response 200
{
  prospects: Array<{
    id: string;                    // coach_clients.id
    name: string;
    invited_email: string | null;
    source_category: string | null;
    source_detail: string | null;
    phases: {
      initial_contact_made: { checked: boolean, at: string | null };
      discovery_call_scheduled: { checked: boolean, at: string | null };
      discovery_call_completed: { checked: boolean, at: string | null };
      sow_sent: { checked: boolean, at: string | null };
      sow_signed: { checked: boolean, at: string | null };
      invoice_sent: { checked: boolean, at: string | null };
      invoice_paid: { checked: boolean, at: string | null };
    };
    last_activity_at: string;      // max of phase timestamps or note created_at
    created_at: string;
  }>;
}
```

Filter: `coach_profile_id = caller's profile`, `status = 'active'`, `lifecycle_status = 'Prospect'`.

#### 6.4.2 POST /api/coach/prospects

Create a new prospect.

```typescript
// Request
{
  name: string;                    // required, min 1 char
  source_category: 'referral' | 'social_media' | 'website' | 'personal_contact' | 'other';  // required
  email?: string;                  // optional; written to invited_email
  source_detail?: string;
  initial_note?: string;           // optional; creates a first note if present
}

// Response 201
{
  prospect: { /* same shape as list item */ };
}

// Errors
// 400 if name or source_category missing/invalid
// 403 if caller is not is_coach
```

Side effects:
- INSERT `coach_clients` with `coach_profile_id = caller`, `client_profile_id = NULL`, `status = 'active'`, `lifecycle_status = 'Prospect'`, `access_level = 'full'`, `invited_email = email ?? NULL`
- If `initial_note` present: INSERT `coach_client_notes` with `coach_client_id = new row's id`, `client_profile_id = NULL`, `coach_profile_id = caller`, `type = 'other'`, `body = initial_note`

#### 6.4.3 GET /api/coach/prospects/[id]

Get a single prospect's full detail.

```typescript
// Response 200
{
  prospect: {
    /* same shape as list item, plus: */
    notes: Array<{
      id: string;
      type: 'session_recap' | 'action_item' | 'other';
      body: string;
      priority: string | null;
      completed_at: string | null;
      created_at: string;
    }>;
  };
}

// Errors
// 404 if id not found or not owned by caller
```

Ownership check: `coach_clients.coach_profile_id = caller's profile AND coach_clients.id = [id]`. Does NOT require `lifecycle_status = 'Prospect'` — the detail endpoint also serves the post-conversion Client-without-profile case.

#### 6.4.4 PATCH /api/coach/prospects/[id]

Update prospect fields (including lifecycle_status for conversion).

```typescript
// Request — all fields optional
{
  name?: string;
  email?: string | null;
  source_category?: 'referral' | 'social_media' | 'website' | 'personal_contact' | 'other';
  source_detail?: string | null;
  phases?: {
    initial_contact_made?: boolean;
    discovery_call_scheduled?: boolean;
    discovery_call_completed?: boolean;
    sow_sent?: boolean;
    sow_signed?: boolean;
    invoice_sent?: boolean;
    invoice_paid?: boolean;
  };
  lifecycle_status?: 'Prospect' | 'Active' | 'Inactive' | 'Archived';
}

// Response 200
{
  prospect: { /* updated full detail */ };
}
```

Side effects:
- For each phase set to `true` that was previously `false`: also set the corresponding `_at` column to `now()`
- For each phase set to `false` that was previously `true`: clear the `_at` column (uncheck means unchecked)
- All updates atomic in a single UPDATE statement

Server-side phase timestamp logic happens here, not in the client. Prevents client-clock drift from contaminating the timestamp record.

#### 6.4.5 Notes routes — `/api/coach/prospects/[id]/notes` and `/notes/[noteId]`

Same shape as the existing `coach_client_notes` routes but keyed by `coach_clients.id` instead of `client_profile_id`. Implementations are near-copies of the existing routes with the query filter swapped.

In v0.1 we add new route files rather than refactoring the existing routes to handle both shapes. Future consolidation possible but not in scope.

### 6.5 API endpoint — Send SIGNAL invite

#### POST /api/coach/coach-clients/[id]/send-invite

Where `[id]` is the `coach_clients.id`. Path-prefix `/coach-clients/` (not `/clients/`) avoids the URL-semantic collision with the existing `/api/coach/clients/[clientId]/*` routes where `[clientId]` = `client_profile_id`.

Available on `coach_clients` rows where `client_profile_id IS NULL` and `lifecycle_status IN ('Active', 'Inactive')` (no invites to Prospects; no invites to Archived).

```typescript
// Request
{
  resume_text?: string;            // optional; if present, creates client_personas
  // Other fields (name, email) read from the existing coach_clients row
}

// Response 201
{
  client_profile_id: string;       // newly-created profile id
  coach_client_id: string;
  email_sent: boolean;
}

// Errors
// 400 if email is missing on the coach_clients row
// 409 if coach_clients.client_profile_id is already set (already invited)
// 422 if lifecycle_status is 'Prospect' or 'Archived'
```

Side effects (sequential, with compensating cleanup pattern matching existing `coach/create-client`):
1. Validate email is present on coach_clients row
2. Validate lifecycle_status is 'Active' or 'Inactive'
3. Create auth user via `supabase.auth.admin.createUser`
4. INSERT `client_profiles` with captured name + email + (resume_text if provided)
5. UPDATE `coach_clients` SET `client_profile_id = new_profile_id`
6. If resume_text: INSERT `client_personas`
7. Generate magic link
8. Send invite email

Failure handling mirrors `coach/create-client` (compensating delete of auth user + profile if downstream steps fail).

### 6.6 LifecycleStatusPill context-aware refactor

The pill currently PATCHes `/api/coach/clients/{clientProfileId}`. Refactor:

```typescript
type LifecycleStatusPillProps = {
  currentStatus: LifecycleStatus;
  coachClientId: string;           // NEW: always present
  clientProfileId: string | null;  // CHANGED: now nullable
  // ... existing props
}
```

PATCH target selection:
- If `clientProfileId !== null`: PATCH `/api/coach/clients/{clientProfileId}` (existing route, unchanged)
- If `clientProfileId === null`: PATCH `/api/coach/prospects/{coachClientId}` (new route)

Two render sites need updating (per round 3 investigation):
- `app/dashboard/coach/page.tsx:620` (Coach Home ClientRow)
- `app/dashboard/coach/clients/page.tsx:224-227`

The third render site (`ClientHeaderStrip` on client detail) is structurally unreachable for prospects today and doesn't need changes. After v0.1 ships, the new client-shaped detail route (§5.5 option b) will render the pill with both IDs available.

### 6.7 Frontend structure

New routes:
- `/dashboard/coach/prospects` — list view
- `/dashboard/coach/prospects/[id]` — prospect detail view
- `/dashboard/coach/clients/[id]/by-coach-client` (or similar) — new client detail route keyed by coach_clients.id, for clients-without-profile (handles the post-conversion-pre-invite state). Specific URL TBD during implementation.

Nav addition in `app/dashboard/layout.tsx` `COACH_NAV`:
```typescript
{
  header: "COACHES CENTER",
  items: [
    { href: "/dashboard/coach", label: "Dashboard" },
    { href: "/dashboard/coach/required-actions", label: "Required Actions" },
    { href: "/dashboard/coach/prospects", label: "Prospects", matchPrefix: true },
    { href: "/dashboard/coach/clients", label: "My Clients", matchPrefix: true },
  ],
}
```

Order: Prospects above My Clients reflects the funnel direction (prospects come before clients in the coach's workflow).

Existing "Active Prospects" tile on Coach Home updates its href from `/dashboard/coach/clients?filter=prospect` to `/dashboard/coach/prospects`. The `?filter=prospect` URL plumbing on the clients page remains functional (per round 3 verification) but is no longer the primary nav target.

---

## 7. Implementation phases (commit sequence)

Four commits, each independently verifiable on staging:

### Commit 1: Schema migration
- `supabase/migrations/20260522_prospects_v0_1.sql`
- Apply to dev via Supabase SQL Editor
- Verify columns, constraints, partial index present
- No code changes
- Verification: SELECT against information_schema confirms new columns; existing rows unaffected

### Commit 2: Notes refactor + send-invite endpoint
- Modify 5 existing `coach_client_notes` routes to filter by `coach_client_id`
- Add new prospect notes routes (`/api/coach/prospects/[id]/notes/*`)
- Add `POST /api/coach/coach-clients/[id]/send-invite` endpoint
- No behavior change for existing client notes (data is fully populated)
- Verification: existing client notes work identically; new endpoints respond correctly to test calls

### Commit 3: NULL hardening + heuristic exclusion
- Apply the 5 edit points in `/api/coach/home`
- Filter prospects out of heuristicClients at the call site
- Defensive, no new feature surface
- Verification: existing Coach Home renders identically (no prospects in DB yet, so heuristic input is unchanged)

### Commit 4: Prospect feature (full surface)
- New API endpoints (`/api/coach/prospects/*`)
- New frontend pages (`/dashboard/coach/prospects` list + detail)
- "+ Add Prospect" modal
- LifecycleStatusPill context-aware refactor
- Nav addition
- New client detail route keyed by coach_clients.id (for post-conversion-pre-invite state)
- Client detail "Prospect history" block + "Send SIGNAL invite" button
- Update Coach Home tile href
- Verification: end-to-end capture → edit → convert → invite flow works for a test prospect

Each commit goes through the standard gate: tsc clean → npm build clean → tests pass → git diff review → commit approval → push to dev → SHA verify on staging → /api/version browser verify.

---

## 8. Testing strategy

### Unit tests

- `PATCH /api/coach/prospects/[id]` phase timestamp logic — checking a previously-unchecked phase sets the `_at` column; unchecking clears it
- Source_category CHECK constraint — invalid value rejected at DB layer
- Notes routes filter by coach_client_id correctly

### Integration tests

- POST /api/coach/prospects creates a row with the expected shape, no SIGNAL account
- GET /api/coach/prospects returns only the calling coach's prospects, never another coach's
- PATCH /api/coach/prospects/[id] with `lifecycle_status: "Active"` flips the row; subsequent GET /api/coach/prospects no longer returns it
- POST /api/coach/coach-clients/[id]/send-invite for a converted Prospect creates auth user + profile + links coach_clients row
- send-invite errors: 422 if lifecycle_status='Prospect', 409 if profile already linked, 400 if email missing

### Notes refactor regression

- All 5 existing routes (`GET/POST/PUT/DELETE` note-feed, `GET needs-attention`, `GET action-items`) return identical results before vs. after the refactor against existing dev data

### /api/coach/home NULL hardening

- Existing Coach Home behavior unchanged when no prospects exist (regression baseline)
- After inserting a test prospect: Coach Home renders without errors, prospect appears with correct empty stats, no `r1:null` signals in requiresAction

### Frontend tests

- Prospect list renders all required fields
- Capture modal: required-field validation, source_category radio works
- Detail view: phase checkbox toggles update the timestamp display
- LifecycleStatusPill on a prospect row PATCHes the prospect endpoint, not the client endpoint
- Conversion flow: clicking "Convert to Client" changes status and redirects to the new client-shaped detail page
- Send SIGNAL invite flow: creates account, transitions UI to full client experience

### Live test

- One beta coach (TBD) captures a real prospect end-to-end on dev: enter name + source, check phases, add notes, convert to Client, send SIGNAL invite

---

## 9. Risks and mitigations

### Risk: Existing routes break when prospect rows appear with NULL client_profile_id

**Impact:** Coach Home, heuristic engine, or other surfaces error out when they encounter coach_clients rows without a linked profile.

**Mitigation:** Commit 3 (NULL hardening) ships before Commit 4 (feature surface). Prospects can't exist before Commit 4, and the NULL handling is in place before they can appear. The round 3 investigation enumerated every break point; no new ones expected.

### Risk: Conversion flow leaves the row in an awkward URL state

**Impact:** Coach converts a prospect, lands on `/dashboard/coach/prospects/[id]` which now shows a Client. Mental model breaks.

**Mitigation:** Frontend redirects to the new `/dashboard/coach/clients/[id]/by-coach-client` (or similar) route on conversion. This route handles the no-profile state cleanly.

### Risk: Coach sends SIGNAL invite to a Prospect by mistake

**Impact:** Profile + auth user created for someone who hasn't converted yet. Violates the "Prospect = no SIGNAL access" principle.

**Mitigation:** Server-side: `POST /api/coach/coach-clients/[id]/send-invite` returns 422 if `lifecycle_status = 'Prospect'`. UI: send-invite button only appears on Active-status records.

### Risk: Notes refactor breaks existing client notes

**Impact:** The 5 refactored routes return wrong results, lose notes, or fail.

**Mitigation:** Round 3 verified that `coach_client_id` is fully populated on existing notes (14 rows, zero NULLs). The refactor changes WHERE clauses to filter by an already-populated column. Identical results expected. Regression tests against dev data confirm before merging.

### Risk: Email-optional prospects create downstream confusion

**Impact:** Coach captures "Sarah (no email)", later wants to send SIGNAL invite, can't.

**Mitigation:** Send-invite endpoint returns 400 if email is missing. Frontend shows clear "Add an email before sending invite" message. Coach edits the row to add email, then sends invite.

### Risk: Phase list doesn't match other coaches' workflows

**Impact:** Beta coaches push back on the locked phase list ("we need a step between Discovery Call and SOW").

**Mitigation:** Phase list is locked at 7 values for v0.1, explicitly so. The schema doesn't enforce sequence — adding new phases in v0.2 is purely additive (new columns) and doesn't break existing rows. Custom-phases-per-coach is in non-goals; v0.2 conversation if needed.

### Risk: Two coaches independently prospect the same person, person eventually becomes both their clients

**Impact:** Same email ends up creating two `client_profiles` rows (one per coach who sends invite) — but `client_profiles.email` is UNIQUE.

**Mitigation:** When coach A sends invite first, profile is created. When coach B later tries to send invite for the same email, the existing `coach/create-client`-style flow either:
- (a) Detects the existing profile and links coach B's coach_clients row to it (correct behavior)
- (b) 409s on the UNIQUE constraint and surfaces the conflict

The send-invite endpoint needs explicit handling for "profile already exists for this email" — find the existing profile, link the coach_clients row to it, skip the auth user creation, send the invite. This is similar to the `findOrCreateSignalApplication` pattern used elsewhere. Worth confirming during Commit 2 implementation.

---

## 10. Dependencies

### Blocks

- Future prospect analytics features (avg time-to-convert, source attribution dashboards)
- Future client capture-without-invite (currently `coach/create-client` always creates auth user; a "create client, don't invite yet" path would build on this)

### Blocked by

- `coach_clients.lifecycle_status` column (shipped 2026-05-21)
- `coach_client_notes` table with `coach_client_id` column (shipped 2026-05-09, fully populated)
- Existing coach auth pattern (admin client + bearer token + is_coach check)

### External dependencies

- Supabase auth admin API (for send-invite endpoint — same dependency as existing create-client)
- Magic link delivery (same as existing invite flow)

---

## 11. Operational constraints

### Dev-only by default

All changes ship to dev environment first. Production promotion is a separate explicit step requiring Peri approval. Beta coaches will be invited to test on dev before production rollout.

### Migration approach

Migration applies to dev via Supabase SQL Editor (per Foundation Risk 6 workaround). The `supabase/migrations/20260522_prospects_v0_1.sql` file is the source of truth; the runlog records the manual application.

### Beta rollout strategy

1. Internal testing (Peri) on dev after each commit
2. Beta coach invitation (small group, dev environment) after Commit 4
3. Beta feedback loop: iterate on UX, phase list, source categories based on real usage
4. Production promotion after beta sign-off

### Monitoring

- Track count of `coach_clients` rows with `lifecycle_status = 'Prospect'` over time (adoption signal)
- Track Prospect → Client conversion events (count + time-to-convert distribution)
- Track send-invite failures by reason (no email, profile already exists, etc.)
- Track notes-on-prospects volume (validates that prospect notes are actually used vs. just supported)

### Rollback plan

- Schema rollback: DROP COLUMN for all new columns (no production data depends on them yet); RE-ADD NOT NULL on invited_email and coach_client_notes.client_profile_id (would require backfill if any prospect rows exist)
- API rollback: remove new route files; revert refactored routes to previous WHERE-clause patterns
- Frontend rollback: remove new pages, revert LifecycleStatusPill prop changes, restore nav
- The four-commit structure means rollback can target specific layers without affecting others

---

## 12. Open questions

1. **Post-conversion detail route URL.** New client detail route for `client_profile_id IS NULL` case — should it be `/dashboard/coach/clients/[id]/by-coach-client` (explicit), `/dashboard/coach/clients/cc/[id]` (path namespace), or something else? Decide during Commit 4 implementation.

2. **Existing /api/coach/home tile href update.** When the "Active Prospects" tile points to `/dashboard/coach/prospects`, does the `?filter=prospect` URL on the clients page still serve any purpose? Probably yes (deep-linkable from elsewhere). Keep the filter machinery, remove the tile-to-filter linkage.

3. **Pre-existing coach_clients rows with NULL client_profile_id (pending invites).** These exist today (status='pending' from invite flow). They're filtered out of `/api/coach/home` by `status='active'`. Confirm they don't accidentally surface in the Prospects list (the filter is `lifecycle_status='Prospect'`, but pending rows likely have `lifecycle_status='Active'` from the column default).

4. **Phase timestamp precision.** Server-side `now()` at PATCH time. Acceptable precision for coach analytics? Almost certainly yes; flag here in case it's not.

5. **Initial note in capture modal.** Optional `initial_note` field in POST /api/coach/prospects — is this worth shipping in v0.1, or is "add a note after capture" sufficient? Argument for keeping: saves a step at networking-event capture. Argument for cutting: simplifies the modal. Lean keep.

6. **Email deduplication within a single coach.** A coach should probably not be able to create two prospects with the same email (vs. two coaches independently — which we want to allow). Add a soft check at POST time?

7. **Coaches Center triage doc.** Where does this feature fit in the broader Coaches Center build sequence? Reference: `docs/coaches-center-triage-2026-05-18.md`. Worth updating that doc to reflect this FRD's scope.

8. **Required Actions surface for prospects.** Should prospect-related actions (e.g., "Discovery call scheduled for Sarah tomorrow") appear in Required Actions? Out of v0.1 scope explicitly (no reminders / follow-up dates), but worth flagging for v0.2.

---

## 13. v0.1 ship plan

Target: end-to-end Prospect capture → edit → convert → send SIGNAL invite, working in dev with one beta coach.

Build order maps to §7 commit sequence:

1. **Commit 1** — schema migration applied to dev (~30 min)
2. **Commit 2** — notes refactor + send-invite endpoint (~2-3 hours)
3. **Commit 3** — NULL hardening (~1 hour)
4. **Commit 4** — full feature surface (~6-8 hours, the bulk of the work)

First beta coach: TBD. Likely Peri herself as initial user, then one external beta coach within 1-2 weeks of v0.1 shipping to dev.

---

## 14. Acceptance criteria

Prospects v0.1 is complete when:

- ✅ Schema migration applied to dev DB with all new columns + constraints + partial index
- ✅ All 5 new API endpoints exist and pass integration tests
- ✅ 5 existing `coach_client_notes` routes refactored to filter by `coach_client_id`; regression tests confirm identical behavior on existing data
- ✅ `/api/coach/home` NULL hardening applied (5 edit points)
- ✅ `runHeuristics` invocation filters prospects out
- ✅ New `/dashboard/coach/prospects` list and detail pages render correctly
- ✅ "+ Add Prospect" modal captures with 3 required fields, optional rest
- ✅ Phase checkboxes toggle correctly; timestamps update on check
- ✅ Notes feed works on prospect rows
- ✅ LifecycleStatusPill PATCHes the correct endpoint based on prospect vs. client context
- ✅ Manual Prospect → Client conversion works; row disappears from Prospects list, appears in My Clients
- ✅ "Send SIGNAL invite" button on Client-without-profile records creates auth user + profile + sends magic link
- ✅ Prospect history block renders on Client detail pages after conversion (collapsed, expandable)
- ✅ Nav addition shows "Prospects" item in COACHES CENTER group
- ✅ No regressions in existing Coach Home, My Clients, Client Detail, Notes, Action Items, or other coach surfaces
- ✅ Internal testing completed by Peri in dev
- ✅ One beta coach successfully captures, manages, and converts a real prospect

Production promotion requires separate Peri approval.

---

## 15. References

- **Round 1 investigation report:** Schema + linkage + RLS + FK + auth pattern + status usage (in conversation thread)
- **Round 2 investigation report:** PATCH handler + notes schema + LifecycleStatusPill + cross-cutting reads + auth + filter (in conversation thread)
- **Round 3 investigation report:** Backfill state + heuristic NULL handling + edit points + consumers + UNIQUE + migrations (in conversation thread)
- **Existing migrations:**
  - `supabase/migrations/20260413_coach_client_system.sql` (coach_clients CREATE)
  - `supabase/migrations/20260509_coach_client_notes_typed.sql` (notes table)
  - `supabase/migrations/20260521_coach_client_lifecycle_status.sql` (lifecycle_status column)
- **Existing code referenced:**
  - `app/api/coach/create-client/route.ts` (template for send-invite)
  - `app/api/coach/invite/route.ts` (existing pending-invite flow)
  - `app/api/coach/clients/[clientId]/route.ts` (existing PATCH route, keyed by client_profile_id)
  - `app/dashboard/coach/LifecycleStatusPill.tsx` (refactor target)
  - `app/api/coach/home/route.ts` (NULL hardening + heuristic call site)
  - `app/api/_lib/coachEngagementHeuristics.ts` (heuristic engine)
- **Coaches Center triage:** `docs/coaches-center-triage-2026-05-18.md`
- **Coaches Center snapshot:** `docs/Features/coaches-center-snapshot.md`
