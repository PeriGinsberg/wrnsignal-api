# Network Tracker — Data Model (v3)

**Stack:** PostgreSQL 17 on Supabase, accessed via `@supabase/supabase-js`. **No ORM.**
Schema is raw SQL in `supabase/migrations/`. Enums are `TEXT` + `CHECK`. PKs are
`uuid DEFAULT gen_random_uuid()`. Owner key is **`client_profile_id`** → `client_profiles(id)`.
All identifiers are snake_case. `author_role` uses **`client`** (not "student").

Tables are prefixed `network_` (domain convention, avoids colliding with the existing
`app/dashboard/tracker` job tracker and generic names).

> **This doc reflects v3** (reconciliation to WRN Tracker v3 — see
> `network-tracker-reconciliation.md`). Two migrations exist:
> - `20260723_network_tracker.sql` — v1 (superseded).
> - **`20260723_network_tracker_v3_reconcile.sql`** — the current shape. A clean re-drop
>   (dev is disposable), so it recreates every table at the v3 shape. The SQL below IS that
>   migration. DEV first via the Supabase SQL Editor; prod promotion is a separate step.

---

## Migration text — `supabase/migrations/20260723_network_tracker_v3_reconcile.sql`

```sql
-- 20260723_network_tracker_v3_reconcile.sql
-- Migration 2 — reconcile the Network Tracker to WRN Tracker v3.
-- CLEAN RE-DROP: dev is disposable, so drop all network_* tables and recreate at
-- the v3 shape rather than ALTERing. Re-runnable. Reseed with the fixture after.

-- ===================== drop (FK-safe order) =====================
DROP TABLE IF EXISTS public.network_comments        CASCADE;
DROP TABLE IF EXISTS public.network_actions         CASCADE;
DROP TABLE IF EXISTS public.network_contacts        CASCADE;
DROP TABLE IF EXISTS public.network_companies       CASCADE;
DROP TABLE IF EXISTS public.network_client_profile  CASCADE;

-- ===================== shared updated_at trigger =====================
CREATE OR REPLACE FUNCTION public.network_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================== network_companies (target) =====================
CREATE TABLE public.network_companies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,  -- board owner
  name              text NOT NULL,
  domain            text,
  -- v3: priority -> tier. How much the client wants to work there. Distinct from
  -- contact-level priority (A/B/C). UI label "Tier".
  tier              text CHECK (tier IS NULL OR tier IN ('dream','strong','backup')),  -- blank until set
  status            text CHECK (status IS NULL OR status IN ('researching','actively_working','paused','closed')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Name dedup is the expression index below, not a table constraint.
);
CREATE INDEX idx_network_companies_owner ON public.network_companies (client_profile_id);
CREATE UNIQUE INDEX uq_network_companies_name ON public.network_companies (client_profile_id, lower(name));
CREATE TRIGGER network_companies_set_updated_at
  BEFORE UPDATE ON public.network_companies
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ===================== network_contacts (person) =====================
CREATE TABLE public.network_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES public.network_companies(id) ON DELETE SET NULL,  -- optional: standalone allowed

  first_name        text NOT NULL,
  last_name         text NOT NULL,
  title             text,
  email             text,
  linkedin_url      text,

  -- v3 fields
  relationship      text CHECK (relationship IS NULL OR relationship IN
                      ('personal','affinity','referred','cold','recruiter')),  -- picks the template family (§8)
  segment           text,                          -- which target list; metrics split reply rate by this
  priority          text CHECK (priority IS NULL OR priority IN ('A','B','C')),  -- contact work order (≠ company tier)

  -- provenance (imported, NEVER drives logic). warm_cold kept for import only.
  source            text,
  warm_cold         text CHECK (warm_cold IS NULL OR warm_cold IN ('warm','cold')),
  campaign_id       text,
  company_domain    text,

  -- pipeline (tracker-owned, NEVER imported). 11-stage v3 vocabulary.
  stage             text NOT NULL DEFAULT 'identified'
                      CHECK (stage IN (
                        'identified','intro_requested','sequence_active','replied',
                        'chat_scheduled','chat_done','nurture','ask_made','outcome',
                        'dormant_no_answer','dormant_declined')),
  outcome_type      text CHECK (outcome_type IS NULL OR outcome_type IN ('referral','intro','lead')),
  dormant_since     timestamptz,

  -- reminder engine (next_due_at is STORED, recomputed on every write)
  last_action_at    timestamptz,
  reminder_override timestamptz,
  next_due_at       timestamptz,
  next_due_reason   text CHECK (next_due_reason IS NULL OR next_due_reason IN (
                      'touch_2','touch_3','intro_chase','reply','thank_you',
                      'nurture_recurring','ask_followup','resurface_no_answer',
                      'resurface_declined','poke','manual')),

  -- Start of the CURRENT outreach cycle — stamped on any transition INTO
  -- sequence_active. The engine counts only touches with action_date >= this.
  cycle_started_at  timestamptz,

  notes             text,
  additional_info   text,        -- migration 4: per-contact context; [ADDITIONAL_INFO] merge var (Phase 8). Detail-page only.

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Dedup is the two partial expression indexes below, not a table constraint.
);
CREATE INDEX idx_network_contacts_worklist ON public.network_contacts (client_profile_id, next_due_at);
CREATE INDEX idx_network_contacts_company  ON public.network_contacts (company_id);
CREATE UNIQUE INDEX uq_network_contacts_at_company
  ON public.network_contacts (client_profile_id, lower(first_name), lower(last_name), company_id)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX uq_network_contacts_standalone
  ON public.network_contacts (client_profile_id, lower(first_name), lower(last_name))
  WHERE company_id IS NULL;
CREATE TRIGGER network_contacts_set_updated_at
  BEFORE UPDATE ON public.network_contacts
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ===================== network_actions (dated action log) =====================
CREATE TABLE public.network_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  -- v3: touch_1/2/3 replace initial_contact + follow_up_*; chat_* replace meeting_*.
  -- The engine counts touch_2/touch_3 in-cycle to drive the sequence.
  type        text NOT NULL CHECK (type IN (
                'touch_1','touch_2','touch_3','intro_request','thank_you',
                'connection_request','engage_on_post','chat_scheduled','chat_done',
                'ask','note_logged','other')),
  action_date timestamptz NOT NULL,              -- when it happened (may be backdated)
  note        text,
  author_role text NOT NULL DEFAULT 'client' CHECK (author_role IN ('client','coach','system')),
  author_id   uuid,                              -- client_profiles.id of the actor; NULL for system
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_network_actions_contact_date ON public.network_actions (contact_id, action_date DESC);

-- ===================== network_comments (coach layer — mirrors coaching_notes) =====================
CREATE TABLE public.network_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES public.network_companies(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,  -- board owner (scoping + RLS)
  coach_profile_id  uuid REFERENCES public.client_profiles(id),   -- author when coach; NULL for client-authored
  author_role       text NOT NULL CHECK (author_role IN ('coach','client')),
  parent_comment_id uuid REFERENCES public.network_comments(id) ON DELETE CASCADE,  -- threads (future)
  body              text NOT NULL,
  visibility        text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_comments_one_target
    CHECK (num_nonnulls(contact_id, company_id) = 1),          -- exactly one target
  CONSTRAINT network_comments_coach_author_present
    CHECK (author_role <> 'coach' OR coach_profile_id IS NOT NULL)
);
CREATE INDEX idx_network_comments_contact           ON public.network_comments (contact_id);
CREATE INDEX idx_network_comments_company           ON public.network_comments (company_id);
CREATE INDEX idx_network_comments_owner_visibility  ON public.network_comments (client_profile_id, visibility);

-- ===================== network_client_profile (v3 tab 2 — merge vars) =====================
-- One row per client. The 16 merge variables + elevator pitch every template
-- resolves against (§7). Client-editable; coach-editable via the coach layer.
-- All merge vars are text. Column current_role_title holds the [CURRENT_ROLE]
-- merge var — the column is renamed because CURRENT_ROLE is reserved in Postgres.
CREATE TABLE public.network_client_profile (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id  uuid NOT NULL UNIQUE REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  client_first       text,
  current_role_title text,
  current_employer   text,
  school             text,
  grad_year          text,
  degree             text,
  target_field       text,
  target_role        text,
  timeframe          text,
  city               text,
  affinity_1         text,
  affinity_2         text,
  affinity_3         text,
  key_strength       text,
  resume_link        text,
  calendar_link      text,
  elevator_pitch     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER network_client_profile_set_updated_at
  BEFORE UPDATE ON public.network_client_profile
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ===================== RLS (belt-and-suspenders; API is the real guard) =====================
-- The API runs as service-role (bypasses RLS) and enforces ownership +
-- coach_clients/verifyCoachAccess. These policies guard direct/token access.
-- "me" = the caller's client_profiles.id.

ALTER TABLE public.network_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY network_companies_owner_all ON public.network_companies FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

ALTER TABLE public.network_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY network_contacts_owner_all ON public.network_contacts FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

ALTER TABLE public.network_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY network_actions_owner_all ON public.network_actions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.network_contacts c
    WHERE c.id = network_actions.contact_id
      AND c.client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  ));

ALTER TABLE public.network_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY network_comments_coach_owner ON public.network_comments FOR ALL
  USING (coach_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));
CREATE POLICY network_comments_client_read ON public.network_comments FOR SELECT
  USING (
    client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
    AND (author_role = 'client' OR visibility = 'shared')
  );

ALTER TABLE public.network_client_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY network_client_profile_owner_all ON public.network_client_profile FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));
```

### Notes on the schema
- **`updated_at`** is set by the `network_set_updated_at()` **BEFORE UPDATE trigger** — never in app code. `network_actions`/`network_comments` are append-only (no `updated_at`).
- **Two priority systems, disambiguated (§6):** `network_companies.tier` (dream/strong/backup — how much the client wants the firm) vs `network_contacts.priority` (A/B/C — who to work first). One word each, no collision.
- **`relationship` picks the template family (§8):** `personal→P`, `affinity→A`, `referred→R`, `cold→C`, `recruiter→X`; the contact's touch position picks the number. It is the field the product treats as most important — nullable in the DB for import tolerance, but required in practice.
- **Dedup is three case-insensitive expression indexes, no table-level `UNIQUE`.** A table constraint can't hold `lower()`, and every dedup key is case-insensitive. The contact pair is split because Postgres treats NULLs as distinct, so a single index over `company_id` would never fire for standalone contacts. All DB-enforced, not import-code alone:
  - `uq_network_companies_name` — `(client_profile_id, lower(name))`
  - `uq_network_contacts_at_company` — `(client_profile_id, lower(first_name), lower(last_name), company_id) WHERE company_id IS NOT NULL`
  - `uq_network_contacts_standalone` — `(client_profile_id, lower(first_name), lower(last_name)) WHERE company_id IS NULL`

  **Phase 6 import must `onConflict` on these index names**, not on column lists — supabase-js needs the index name for a partial/expression unique, and there is no constraint to fall back on.
- **`next_due_at` is stored**, folded with `reminder_override` at write time, so the worklist stays one indexed scan on `(client_profile_id, next_due_at)`.
- **Coach access is not an RLS concern** — the API (service-role) resolves it via `coach_clients` + `verifyCoachAccess`. RLS only protects direct/token access and follows the `coaching_notes` precedent.

## Reminder intervals (code constant — `lib/network-tracker/reminder-engine.ts`, not a table)

v3: the **three-touch rule** and **two dormant kinds** (reconciliation §1–§4).

```ts
export const STAGE_INTERVALS = {
  identified:        { poke: 7 },                       // optional, OFF unless enabled
  intro_requested:   { intro_chase: 7 },
  sequence_active:   { touch_2: 7, touch_3: 5 },        // touch 2 @ +7d, touch 3 @ +5d, then dormant_no_answer
  replied:           { reply: 1 },                      // same-day
  chat_done:         { thank_you: 1 },
  nurture:           { recurring: 42 },                 // 6 weeks
  ask_made:          { ask_followup: 14 },
  dormant_no_answer: { resurface: 35 },                 // 4-6 weeks
  dormant_declined:  { resurface: 90 },                 // 3 months
} as const;
```

**`computeNextDue()` derivation** (run on every action/stage write, in the API route only):
1. **Override consumed by pipeline activity:** if this is an action-log or stage change and `reminder_override` is set, the override is CONSUMED — fall through to the stage rules and clear the column. Otherwise, if `reminder_override` is set → `next_due_at = reminder_override`, reason `'manual'`. Done.
2. Else pick interval by `stage`. For `sequence_active`, choose the next step by counting `touch_2`/`touch_3` actions **in the current cycle** (`action_date >= cycle_started_at`; all if null): 0→`touch_2`@+7d, 1→`touch_3`@+5d, ≥2→set `stage='dormant_no_answer'`, `dormant_since=base`, resurface @ +35d.
3. `chat_scheduled`/`outcome` → no due (null). `nurture` reschedules +42d each write. The two dormant stages resurface from `dormant_since` (+35d no-answer, +90d declined).
4. `next_due_at = last_action_at + intervalDays` (falling back to `created_at`). The engine's ONLY stage write is `sequence_active → dormant_no_answer`; the declined dormant is a manual move.

## Daily worklist query (supabase-js, in the API route)

```ts
const { data } = await supabase
  .from("network_contacts")
  .select("*, network_companies(name)")
  .eq("client_profile_id", profileId)
  .lte("next_due_at", new Date().toISOString())
  .order("next_due_at", { ascending: true });   // overdue first, backed by (client_profile_id, next_due_at)
```

## Import mapping — SUPERSEDED

**Replaced in full by `network-tracker-import.md`.** That earlier fixed-header contract
assumed files arrive in our shape; real client lists don't (one Name column, headers on
row 4, no shared column names, XLSX not CSV). The import is now upload → guess → preview →
confirm. See IMPORT.md for header-row detection, the synonym-based column mapping, name
splitting, non-person rows, email-is-not-unique, and the deliberately-blank fields. Dedup is
unchanged (`uq_network_contacts_at_company` / `uq_network_contacts_standalone`, skip existing).
```
