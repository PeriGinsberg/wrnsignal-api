-- ════════════════════════════════════════════════════════════════════════
-- SIGNAL — production promotion, August 2026
-- Migrations 1..13, bundled in dependency order.
--
-- Generated 2026-08-09 from commit 44c854d9, so section 02 is the GUARDED
-- network reconcile. Plan: docs/prod-promotion-2026-08.md
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor on PROD
--   (project ejhnokcnahauvrcbcmic) and run it once, in one go.
--
-- ALL OR NOTHING
--   Everything sits inside a single BEGIN/COMMIT. Any error anywhere —
--   including the preflight and postflight assertions — aborts the whole
--   thing and leaves the database exactly as it was. There is no partial
--   apply to unpick. Do not run the sections individually; that is the one
--   way to lose this property.
--
--   If it aborts: read the error, change nothing, and come back with it.
--
-- WHAT SUCCESS LOOKS LIKE
--   The last NOTICE reads "PROMOTION COMPLETE". A verification SELECT runs
--   after COMMIT and returns one row per created artefact.
--
-- WHAT THIS DOES NOT DO
--   No data is migrated except two in-file backfills (section 12 sets
--   is_signoff, section 13 backfills coaching_notes.application_id — which
--   will update ZERO rows on prod, because both existing notes are orphans.
--   Zero is the correct result there, not a failure. See plan section 6.)
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── PREFLIGHT ───────────────────────────────────────────────────────────
-- Two things: that the tables these migrations build on actually exist, and
-- that we are not pointed at the wrong database. The second matters more —
-- dev already has network_contacts, so this aborts immediately if this file
-- is ever pasted into a dev SQL Editor by accident.
DO $preflight$
DECLARE t text; missing text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['client_profiles','coach_client_engagements','coach_client_engagement_deliverables','coach_client_engagement_activities','coaching_notes','jobfit_runs','signal_applications','signal_interviews'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing := missing || format('    %s%s', t, chr(10));
    END IF;
  END LOOP;
  IF missing <> '' THEN
    RAISE EXCEPTION E'PREFLIGHT FAILED — these tables must already exist:
%', missing
      USING HINT = 'This database is not the expected production schema. Stop.';
  END IF;

  IF to_regclass('public.network_contacts') IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT FAILED — network_contacts already exists.'
      USING HINT = 'Prod was probed 2026-08-09 with no network schema. Either this '
                   'already ran, or this is not prod (dev has these tables). Stop and re-probe.';
  END IF;

  RAISE NOTICE 'Preflight passed: % prerequisites present, network schema absent.', 8;
END
$preflight$;


-- ════════════════════════════════════════════════════════════════════
-- [01/13]  20260723_network_tracker.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec01$ BEGIN RAISE NOTICE '[01/13] applying 20260723_network_tracker'; END $sec01$;

-- 20260723_network_tracker.sql
-- Network Tracker v1: companies, contacts, actions, comments.
-- Owner = client_profiles.id (client_profile_id). Enums via CHECK constraints.
-- RLS on every table (belt-and-suspenders); the API uses service-role + does the
-- real authz (resolveCaller ownership; coach reach via coach_clients + verifyCoachAccess).
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor. Prod promotion is a separate,
-- human-reviewed step. NEVER auto-applied.

-- ================= shared updated_at trigger =================
-- SIGNAL has no ORM auto-update, so updated_at is maintained by a BEFORE UPDATE
-- trigger — one mechanism, never set by hand in app code.
CREATE OR REPLACE FUNCTION public.network_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================= network_companies (target) =================
CREATE TABLE IF NOT EXISTS public.network_companies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,  -- board owner
  name              text NOT NULL,
  domain            text,
  priority          text CHECK (priority IS NULL OR priority IN ('dream','strong','backup')),  -- blank until set
  status            text CHECK (status IS NULL OR status IN ('researching','actively_working','paused','closed')),  -- blank on import
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Name dedup is the expression index below, not a table constraint: a
  -- table-level UNIQUE cannot hold lower(), and "GBQ"/"gbq" are one company.
);
CREATE INDEX IF NOT EXISTS idx_network_companies_owner
  ON public.network_companies (client_profile_id);
-- One company per board per name, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_companies_name
  ON public.network_companies (client_profile_id, lower(name));
-- CREATE TRIGGER has no IF NOT EXISTS in Postgres — drop first so the whole
-- migration stays re-runnable (the CREATE TABLEs already are).
DROP TRIGGER IF EXISTS network_companies_set_updated_at ON public.network_companies;
CREATE TRIGGER network_companies_set_updated_at
  BEFORE UPDATE ON public.network_companies
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ================= network_contacts (person) =================
CREATE TABLE IF NOT EXISTS public.network_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES public.network_companies(id) ON DELETE SET NULL,  -- optional: standalone allowed

  first_name        text NOT NULL,
  last_name         text NOT NULL,
  title             text,
  email             text,
  linkedin_url      text,

  -- provenance (imported, NEVER drives logic)
  source            text,
  warm_cold         text CHECK (warm_cold IS NULL OR warm_cold IN ('warm','cold')),
  campaign_id       text,
  company_domain    text,                        -- raw import value, pre-match

  -- pipeline (tracker-owned, NEVER imported)
  stage             text NOT NULL DEFAULT 'not_contacted'
                      CHECK (stage IN ('not_contacted','reached_out','responded',
                                       'meeting_held','nurture','outcome','dormant')),
  responded_branch  text CHECK (responded_branch IS NULL OR responded_branch IN ('positive','declined_alive')),
  outcome_type      text CHECK (outcome_type IS NULL OR outcome_type IN ('referral','intro','lead')),
  dormant_since     timestamptz,

  -- reminder engine (next_due_at is STORED, recomputed on every write)
  last_action_at    timestamptz,
  reminder_override timestamptz,
  next_due_at       timestamptz,
  next_due_reason   text CHECK (next_due_reason IS NULL OR next_due_reason IN
                      ('follow_up_1','follow_up_2','follow_up_3','reply','thank_you',
                       'nurture_recurring','resurface','poke','manual')),

  -- Start of the CURRENT outreach cycle — stamped by the stage route on any
  -- transition INTO reached_out. computeNextDue() counts only follow-ups with
  -- action_date >= this instant, so a contact worked a second time does not
  -- inherit the first cycle's exhausted FU3 and flip straight back to dormant.
  -- NULL (never re-engaged) means "count all follow-ups" — the original rule.
  cycle_started_at  timestamptz,

  notes             text,                        -- client's own notes

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Dedup is enforced by the two partial UNIQUE INDEXes below, not a table
  -- constraint: a table-level UNIQUE cannot contain expressions, and both halves
  -- must be case-insensitive ("Dana"/"dana" is the same person to an importer).
);
-- The front door: single indexed scan for the daily worklist.
CREATE INDEX IF NOT EXISTS idx_network_contacts_worklist
  ON public.network_contacts (client_profile_id, next_due_at);
CREATE INDEX IF NOT EXISTS idx_network_contacts_company
  ON public.network_contacts (company_id);
-- Dedup, both halves case-insensitive and DB-enforced (not import-code alone).
-- Split in two because Postgres treats NULLs as distinct: a single index over
-- company_id would never fire for standalone contacts.
--   (a) company-attached: same name at the same company is the same person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_contacts_at_company
  ON public.network_contacts (client_profile_id, lower(first_name), lower(last_name), company_id)
  WHERE company_id IS NOT NULL;
--   (b) standalone: same name with no company is the same person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_contacts_standalone
  ON public.network_contacts (client_profile_id, lower(first_name), lower(last_name))
  WHERE company_id IS NULL;
DROP TRIGGER IF EXISTS network_contacts_set_updated_at ON public.network_contacts;
CREATE TRIGGER network_contacts_set_updated_at
  BEFORE UPDATE ON public.network_contacts
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ================= network_actions (dated action log) =================
CREATE TABLE IF NOT EXISTS public.network_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('initial_contact','follow_up_1','follow_up_2','follow_up_3',
                                'thank_you','connection_request','engage_on_post',
                                'meeting_scheduled','meeting_held','note_logged','other')),
  action_date timestamptz NOT NULL,              -- when it happened (may be backdated)
  note        text,
  author_role text NOT NULL DEFAULT 'client' CHECK (author_role IN ('client','coach','system')),
  author_id   uuid,                              -- client_profiles.id of the actor; NULL for system
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_network_actions_contact_date
  ON public.network_actions (contact_id, action_date DESC);

-- ================= network_comments (coach layer — mirrors coaching_notes) =================
CREATE TABLE IF NOT EXISTS public.network_comments (
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
CREATE INDEX IF NOT EXISTS idx_network_comments_contact
  ON public.network_comments (contact_id);
CREATE INDEX IF NOT EXISTS idx_network_comments_company
  ON public.network_comments (company_id);
CREATE INDEX IF NOT EXISTS idx_network_comments_owner_visibility
  ON public.network_comments (client_profile_id, visibility);

-- ================= RLS (belt-and-suspenders; API is the real guard) =================
-- CREATE POLICY also has no IF NOT EXISTS — same drop-first treatment.
ALTER TABLE public.network_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_companies_owner_all ON public.network_companies;
CREATE POLICY network_companies_owner_all ON public.network_companies FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

ALTER TABLE public.network_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_contacts_owner_all ON public.network_contacts;
CREATE POLICY network_contacts_owner_all ON public.network_contacts FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

ALTER TABLE public.network_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_actions_owner_all ON public.network_actions;
CREATE POLICY network_actions_owner_all ON public.network_actions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.network_contacts c
    WHERE c.id = network_actions.contact_id
      AND c.client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  ));

ALTER TABLE public.network_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_comments_coach_owner ON public.network_comments;
CREATE POLICY network_comments_coach_owner ON public.network_comments FOR ALL
  USING (coach_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS network_comments_client_read ON public.network_comments;
CREATE POLICY network_comments_client_read ON public.network_comments FOR SELECT
  USING (
    client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
    AND (author_role = 'client' OR visibility = 'shared')
  );


-- ════════════════════════════════════════════════════════════════════
-- [02/13]  20260723_network_tracker_v3_reconcile.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec02$ BEGIN RAISE NOTICE '[02/13] applying 20260723_network_tracker_v3_reconcile'; END $sec02$;

-- 20260723_network_tracker_v3_reconcile.sql
-- Migration 2 — reconcile the Network Tracker to WRN Tracker v3.
-- See docs/network-tracker/network-tracker-reconciliation.md. Supersedes the
-- pipeline/interval shape of migration 1 (20260723_network_tracker.sql).
--
-- ⚠️  DESTRUCTIVE. This drops all network_* tables and recreates them at the v3
-- shape rather than ALTERing. It was written when dev was disposable and there
-- was no data to preserve. That was true of dev in July 2026 and true of prod
-- until the promotion — and it stops being true the moment the first real
-- contact is created. A guard below refuses to run against non-empty tables;
-- read it before you consider overriding it.
--
-- Reseed with scripts/seed-network-fixture.ts afterward.
--
-- Changes vs migration 1:
--   • network_companies.priority  -> tier   (dream|strong|backup; UI label "Tier")
--   • network_contacts: 11-value stage vocab (default 'identified'), 11-value
--     next_due_reason vocab, DROP responded_branch, ADD relationship/segment/priority
--   • network_actions: touch_1/2/3 replaces initial_contact/follow_up_* ; chat_* replaces meeting_*
--   • NEW network_client_profile (16 merge vars + elevator pitch, one row per client)
--
-- DEV ENV ONLY first. Apply via Supabase SQL Editor; prod promotion is a separate,
-- human-reviewed step. NEVER auto-applied.

-- ===================== SAFETY GUARD =====================
--
-- Refuses to proceed if ANY network_* table holds rows. Without this the file is
-- a loaded gun: it is named like a routine migration, it is marked re-runnable,
-- and running it a second time against a live board silently destroys every
-- contact, company, action and note on it. CASCADE means the damage is not
-- confined to the table named on the line.
--
-- Deliberate override, when you genuinely mean to wipe and rebuild:
--   SET network_reconcile.allow_destructive = 'i_have_a_backup';
-- issued in the same session, before this script. It is intentionally awkward.
DO $guard$
DECLARE
  t    text;
  n    bigint;
  tot  bigint := 0;
  hits text := '';
BEGIN
  IF coalesce(current_setting('network_reconcile.allow_destructive', true), '') = 'i_have_a_backup' THEN
    RAISE WARNING 'network v3 reconcile: guard OVERRIDDEN — dropping network_* tables and any data in them.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'network_comments', 'network_actions', 'network_contacts',
    'network_companies', 'network_client_profile'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        tot  := tot + n;
        hits := hits || format('    %s: %s row(s)%s', t, n, chr(10));
      END IF;
    END IF;
  END LOOP;

  IF tot > 0 THEN
    RAISE EXCEPTION E'REFUSING TO RUN — this migration DROPs every network_* table and they are NOT empty.\n\n%\n  Total: % row(s) would be destroyed, plus everything CASCADE reaches.',
      hits, tot
      USING HINT = 'If you truly intend to wipe and rebuild, take a backup, then run: '
                   'SET network_reconcile.allow_destructive = ''i_have_a_backup''; '
                   'in the same session before this script.';
  END IF;

  RAISE NOTICE 'network v3 reconcile: guard passed — all network_* tables absent or empty.';
END
$guard$;

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
  -- Renamed priority -> tier: how much the client wants to work there. Distinct
  -- from contact-level priority (A/B/C). UI label "Tier".
  tier              text CHECK (tier IS NULL OR tier IN ('dream','strong','backup')),  -- blank until set
  status            text CHECK (status IS NULL OR status IN ('researching','actively_working','paused','closed')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Name dedup is the expression index below, not a table constraint.
);
CREATE INDEX idx_network_companies_owner ON public.network_companies (client_profile_id);
-- One company per board per name, case-insensitively.
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

  -- v3 fields ---------------------------------------------------------------
  -- The single most important field: picks the template sequence. Required in
  -- practice, nullable in the DB for import tolerance (reconciliation §5).
  relationship      text CHECK (relationship IS NULL OR relationship IN
                      ('personal','affinity','referred','cold','recruiter')),
  -- Which target list they came from; metrics split reply rate by this (§9).
  segment           text,
  -- Contact-level work order — distinct from company tier (§6).
  priority          text CHECK (priority IS NULL OR priority IN ('A','B','C')),

  -- provenance (imported, NEVER drives logic). warm_cold kept for import only.
  source            text,
  warm_cold         text CHECK (warm_cold IS NULL OR warm_cold IN ('warm','cold')),
  campaign_id       text,
  company_domain    text,

  -- pipeline (tracker-owned, NEVER imported). 11-stage v3 vocabulary. -----------
  stage             text NOT NULL DEFAULT 'identified'
                      CHECK (stage IN (
                        'identified','intro_requested','sequence_active','replied',
                        'chat_scheduled','chat_done','nurture','ask_made','outcome',
                        'dormant_no_answer','dormant_declined')),
  -- responded_branch RETIRED — the declined case is now stage 'dormant_declined'.
  outcome_type      text CHECK (outcome_type IS NULL OR outcome_type IN ('referral','intro','lead')),
  dormant_since     timestamptz,

  -- reminder engine (next_due_at is STORED, recomputed on every write) -----------
  last_action_at    timestamptz,
  reminder_override timestamptz,
  next_due_at       timestamptz,
  next_due_reason   text CHECK (next_due_reason IS NULL OR next_due_reason IN (
                      'touch_2','touch_3','intro_chase','reply','thank_you',
                      'nurture_recurring','ask_followup','resurface_no_answer',
                      'resurface_declined','poke','manual')),

  -- Start of the CURRENT outreach cycle — stamped on any transition INTO
  -- sequence_active. The engine counts only touches with action_date >= this,
  -- so a re-engaged contact does not inherit the old cycle's touches.
  cycle_started_at  timestamptz,

  notes             text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
  -- Dedup is enforced by the two partial UNIQUE INDEXes below, not a table constraint.
);
CREATE INDEX idx_network_contacts_worklist ON public.network_contacts (client_profile_id, next_due_at);
CREATE INDEX idx_network_contacts_company  ON public.network_contacts (company_id);
-- Dedup, both halves case-insensitive. Split because Postgres treats NULLs as distinct.
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
  -- touch_1/2/3 replace initial_contact + follow_up_*; chat_* replace meeting_*.
  -- The engine counts touch_2/touch_3 in-cycle to drive the sequence.
  type        text NOT NULL CHECK (type IN (
                'touch_1','touch_2','touch_3','intro_request','thank_you',
                'connection_request','engage_on_post','chat_scheduled','chat_done',
                'ask','note_logged','other')),
  action_date timestamptz NOT NULL,              -- when it happened (may be backdated)
  note        text,
  author_role text NOT NULL DEFAULT 'client' CHECK (author_role IN ('client','coach','system')),
  author_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_network_actions_contact_date ON public.network_actions (contact_id, action_date DESC);

-- ===================== network_comments (coach layer — unchanged shape) =====================
CREATE TABLE public.network_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        uuid REFERENCES public.network_contacts(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES public.network_companies(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  coach_profile_id  uuid REFERENCES public.client_profiles(id),
  author_role       text NOT NULL CHECK (author_role IN ('coach','client')),
  parent_comment_id uuid REFERENCES public.network_comments(id) ON DELETE CASCADE,
  body              text NOT NULL,
  visibility        text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_comments_one_target
    CHECK (num_nonnulls(contact_id, company_id) = 1),
  CONSTRAINT network_comments_coach_author_present
    CHECK (author_role <> 'coach' OR coach_profile_id IS NOT NULL)
);
CREATE INDEX idx_network_comments_contact           ON public.network_comments (contact_id);
CREATE INDEX idx_network_comments_company           ON public.network_comments (company_id);
CREATE INDEX idx_network_comments_owner_visibility  ON public.network_comments (client_profile_id, visibility);

-- ===================== network_client_profile (v3 tab 2 — merge vars) =====================
-- One row per client. The 16 merge variables + elevator pitch that every
-- template resolves against (reconciliation §7). Client-editable; coach-editable
-- via the coach layer later. All merge vars are text (grad_year may be "2025" or
-- "Class of 2025"; timeframe is prose).
CREATE TABLE public.network_client_profile (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL UNIQUE REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  client_first      text,
  current_role_title text,                        -- maps to the [CURRENT_ROLE] merge var; column avoids the reserved word CURRENT_ROLE
  current_employer  text,
  school            text,
  grad_year         text,
  degree            text,
  target_field      text,
  target_role       text,
  timeframe         text,
  city              text,
  affinity_1        text,
  affinity_2        text,
  affinity_3        text,
  key_strength      text,
  resume_link       text,
  calendar_link     text,
  elevator_pitch    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER network_client_profile_set_updated_at
  BEFORE UPDATE ON public.network_client_profile
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- ===================== RLS (belt-and-suspenders; API is the real guard) =====================
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


-- ════════════════════════════════════════════════════════════════════
-- [03/13]  20260724_network_additional_info.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec03$ BEGIN RAISE NOTICE '[03/13] applying 20260724_network_additional_info'; END $sec03$;

-- 20260724_network_additional_info.sql
-- Migration 4 — add additional_info to network_contacts: per-contact context
-- (hand-written opening lines, "why this person" notes) — the strongest column
-- in real client lists. Feeds Phase 8 templates as the [ADDITIONAL_INFO] merge
-- variable. (IMPORT.md §8 proposed this under the name 'personalization'; the
-- agreed name is additional_info.)
--
-- ADDITIVE ALTER — NOT a re-drop. Independent of and order-agnostic with
-- 20260724_network_first_milestones.sql. Re-runnable via ADD COLUMN IF NOT EXISTS.
--
-- Detail-page only: values are full sentences and never appear as a spreadsheet
-- column. Client-editable on the contact record; importable in Phase 6.
--
-- DEV first via the Supabase SQL Editor; prod promotion is a separate step.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS additional_info text;


-- ════════════════════════════════════════════════════════════════════
-- [04/13]  20260724_network_first_milestones.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec04$ BEGIN RAISE NOTICE '[04/13] applying 20260724_network_first_milestones'; END $sec04$;

-- 20260724_network_first_milestones.sql
-- Migration 3 — add three "first reached" milestone timestamps to
-- network_contacts, needed by the dashboard's reply / chat rates
-- (docs/network-tracker/network-tracker-dashboard.md, Part 1 & Part 3).
--
-- ADDITIVE ALTER — NOT a re-drop. Seeded/imported data survives. Re-runnable
-- via ADD COLUMN IF NOT EXISTS.
--
-- Each is stamped ONCE, on the FIRST time the contact reaches that milestone,
-- and NEVER recomputed — so a reply rate does not fall as contacts progress
-- past 'replied'. Stamping lives in the API routes (set-once, only when NULL):
--   first_touch_at   — first outreach: a touch_1 action, or entering sequence_active
--   first_replied_at — first transition into stage 'replied'
--   first_chat_at    — first transition into stage 'chat_scheduled'
--
-- DEV first via the Supabase SQL Editor; prod promotion is a separate step.

ALTER TABLE public.network_contacts
  ADD COLUMN IF NOT EXISTS first_touch_at   timestamptz,
  ADD COLUMN IF NOT EXISTS first_replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_chat_at    timestamptz;


-- ════════════════════════════════════════════════════════════════════
-- [05/13]  20260727_network_note_action_type.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec05$ BEGIN RAISE NOTICE '[05/13] applying 20260727_network_note_action_type'; END $sec05$;

-- 20260727_network_note_action_type.sql
-- ADDITIVE: add 'note' to network_actions.type.
--
-- WHY A NEW TYPE RATHER THAN A REQUEST FLAG
-- 'note_logged' is doing double duty today. vocab.ts maps four DUE REASONS onto
-- it — reply, nurture_recurring, ask_followup, manual — so the worklist's
-- "Log it" and the spreadsheet's inline Log button both write 'note_logged'
-- when satisfying a due touch that has no more specific type. Those MUST count
-- as pipeline activity: they are how the user says "I did the thing."
--
-- A standalone note is the opposite: it must NOT consume reminder_override, must
-- NOT move last_action_at, and must NOT recompute next_due_at. Making
-- 'note_logged' inert would leave every reply / check-in / manual reminder
-- permanently overdue.
--
-- So the two meanings get two types. The distinction is semantic and permanent,
-- and it belongs in the schema where the DB can enforce it — not in a request
-- flag that leaves already-written rows ambiguous forever.
--
--   'note'         standalone note. Inert. Timeline entry only.
--   'note_logged'  UNCHANGED. Pipeline activity, exactly as before.
--
-- No data migration: no existing row changes type, and nothing is backfilled.
-- Existing 'note_logged' rows keep their current meaning and behaviour.
--
-- The CHECK is inline in 20260723_network_tracker_v3_reconcile.sql, so Postgres
-- auto-named it network_actions_type_check. Dropped and re-added because a CHECK
-- cannot be altered in place.

ALTER TABLE public.network_actions
  DROP CONSTRAINT IF EXISTS network_actions_type_check;

ALTER TABLE public.network_actions
  ADD CONSTRAINT network_actions_type_check CHECK (type IN (
    'touch_1','touch_2','touch_3','intro_request','thank_you',
    'connection_request','engage_on_post','chat_scheduled','chat_done',
    'ask','note_logged','note','other'));

-- PostgREST caches the schema; without this the new value is rejected at the
-- API layer even though the constraint accepts it.
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- [06/13]  20260728_network_client_profile_seed_tracking.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec06$ BEGIN RAISE NOTICE '[06/13] applying 20260728_network_client_profile_seed_tracking'; END $sec06$;

-- 20260728_network_client_profile_seed_tracking.sql
-- ADDITIVE: seed bookkeeping for network_client_profile (Phase 7b).
--
-- The profile is ONE-TIME SEEDED from client_profiles, never live-mirrored. Two
-- of the seeded fields make mirroring actively wrong:
--   • key_strength comes from coach_notes_strengths — a COACH's private note. A
--     mirror would let a coach editing their notes silently rewrite the client's
--     outreach copy.
--   • a networking pitch is worded differently from a formal profile, so any
--     mirror would overwrite the client's tuning on every profile edit.
--
-- touched_fields records which fields the USER has written, so "refresh from
-- profile" can re-offer itself for untouched fields only.
--
-- WHY AN ARRAY RATHER THAN "IS THE FIELD EMPTY"
-- Emptiness cannot tell never-seeded from deliberately-cleared. A client who
-- deletes the coach's strengths note because it does not fit has TOUCHED that
-- field, and a refresh must not put it back. Only an explicit record of user
-- writes gets that right.

-- AUTO-FILL, NOT AUTO-REWRITE
-- A client's source data fills in over time (intake, résumé upload, coach notes),
-- usually AFTER they first open the networking profile — so a one-shot seed
-- catches an empty source and the profile stays blank until someone thinks to
-- press Refresh, which nobody does. Every GET therefore fills fields that are
-- EMPTY *and* untouched *and* whose source now has a value.
--
-- Restricted to EMPTY on purpose. touched_fields cannot tell "never seen it"
-- from "read it and was happy with it", so re-seeding every untouched field
-- would silently rewrite copy the client had already accepted — with
-- key_strength that means a coach editing a private note changes client-facing
-- outreach text. Filling a blank is help; changing something they have seen
-- needs their intent, which is what the Refresh button is for.

ALTER TABLE public.network_client_profile
  ADD COLUMN IF NOT EXISTS touched_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seeded_at timestamptz,
  -- Stamped when the résumé extraction RUNS, whatever it yields. Without it, a
  -- résumé that parses to no usable role leaves both fields empty, so the next
  -- page open recomputes "pending" as true and fires another live LLM call —
  -- on every open, forever. Attempted-once is the gate; the Refresh button is
  -- the deliberate way to try again after a new résumé is uploaded.
  ADD COLUMN IF NOT EXISTS resume_seed_attempted_at timestamptz;

-- PostgREST caches the schema; without this the new columns are invisible to
-- the API even though the table has them.
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- [07/13]  20260728_network_templates.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec07$ BEGIN RAISE NOTICE '[07/13] applying 20260728_network_templates'; END $sec07$;

-- 20260728_network_templates.sql
-- Phase 8a — per-client OVERRIDES of the 24 outreach templates.
--
-- THE DEFAULTS ARE NOT IN HERE, AND THAT IS THE DESIGN.
-- The 24 bodies live in lib/network-tracker/template-defaults.ts, transcribed
-- verbatim from the WRN v3 spreadsheet. This table holds a row ONLY when a
-- client or coach edits one. A client who never edits anything has zero rows,
-- and GET still returns 24 templates by merging code defaults with whatever
-- overrides exist.
--
-- Seeding 24 rows per client instead would mean: a migration to backfill every
-- existing client, a second one every time a default is reworded, and no way to
-- tell "the client chose this wording" from "this is just the default sitting
-- in a row". Deleting the override row IS the revert, which is why DELETE is
-- the whole revert mechanism rather than a copy-the-default-back operation.
--
-- BODIES ARE STORED LITERAL — [BRACKET] VARIABLES INCLUDED.
-- Nothing here or in the routes may normalise, escape, or validate bracket
-- contents. The templates use THREE kinds of variable, and the third breaks
-- naive validation:
--   1. profile   [TARGET_ROLE]      → resolves from network_client_profile
--   2. contact   [NAME] [FIRM]      → resolves from the contact record
--   3. fill-at-send                 → NEVER resolves; the writer completes it
--        [MUTUAL], [ONE SPECIFIC QUESTION], [OPTION 1], [OPTION 2], [OPTION 3],
--        [SPECIFIC THING THEY SAID], [ARTICLE / NEWS ABOUT THEIR FIRM], …
-- Kind 3 contains spaces and slashes. A validator that required UPPER_SNAKE
-- tokens, or that treated an unresolvable bracket as an error, would reject or
-- flag exactly the two templates a client uses most (S1 scheduling, C2 cold
-- follow-up). See docs/network-tracker/template-variables.md; the renderer that
-- acts on the distinction is 8b.
--
-- COACH-WRITABLE, ON PURPOSE.
-- PATCH/DELETE gate on assertBoardAccess(..., 'full'), not owner-only — the same
-- deliberate exception as network_client_profile. "Coaches cannot mutate"
-- protects the PIPELINE (stage, actions, reminders): the client's own record of
-- what they did. Templates are outbound copy a coach is expected to help write,
-- so both may edit and last save wins. edited_by records which of them it was.
-- (There is no 'edit' access level; the levels are view | annotate | full.)

CREATE TABLE IF NOT EXISTS public.network_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  template_id       text NOT NULL,          -- 'C2', 'S1', … must match a default key
  body              text NOT NULL,          -- with [BRACKET] variables, stored literal
  edited_by         text NOT NULL CHECK (edited_by IN ('client','coach')),
  edited_by_id      uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One override per (client, template): the PATCH upserts onto this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_templates_client_template
  ON public.network_templates (client_profile_id, template_id);

CREATE INDEX IF NOT EXISTS idx_network_templates_owner
  ON public.network_templates (client_profile_id);

-- Reuses the trigger function the other network tables already install.
DROP TRIGGER IF EXISTS network_templates_set_updated_at ON public.network_templates;
CREATE TRIGGER network_templates_set_updated_at
  BEFORE UPDATE ON public.network_templates
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- RLS mirrors the other network tables: belt-and-braces, the API is the real guard.
ALTER TABLE public.network_templates ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- [08/13]  20260730_network_profile_help_dismissed.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec08$ BEGIN RAISE NOTICE '[08/13] applying 20260730_network_profile_help_dismissed'; END $sec08$;

-- Per-client "I have read the help on this screen" flags.
--
-- One jsonb rather than a boolean per screen: the Templates callout is the first
-- of the help pass and the spreadsheet and dashboard follow the same pattern, so
-- this is `{"templates": true, "contacts": true, ...}` and needs no further
-- migration as those land.
--
-- Deliberately NOT one of the profile's ALL_FIELDS: those drive the form, the
-- completeness meter and touched_fields, and a UI preference among them would
-- make a finished profile read as "17 of 18". The route writes this only through
-- its own dismiss_help action.
--
-- Additive, defaulted, no backfill: every existing row reads as "nothing
-- dismissed yet", which is the correct starting state.

alter table public.network_client_profile
  add column if not exists help_dismissed jsonb not null default '{}'::jsonb;

comment on column public.network_client_profile.help_dismissed is
  'Per-screen help-callout dismissals, e.g. {"templates": true}. UI state, not profile content.';


-- ════════════════════════════════════════════════════════════════════
-- [09/13]  20260805_application_company_link.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec09$ BEGIN RAISE NOTICE '[09/13] applying 20260805_application_company_link'; END $sec09$;

-- Phase 1 of the tracker/networking merge: one nullable link from an
-- application to a company on the networking board.
--
-- ADDITIVE. No backfill, no default, no existing column altered in type,
-- nullability or default. Every current reader keeps working untouched, and
-- every existing row stays valid with company_id NULL.
--
-- WHY COMPANY LEVEL AND NOT CONTACT LEVEL. A contact reaches an application
-- through their company: network_contacts.company_id already exists, so one
-- link here gives every contact at that company a path to every application
-- there. A contact-to-application link would be a second edge expressing the
-- same fact, and the two would drift.
--
-- Probed on dev before writing, rather than read off the migration files:
--   network_companies EXISTS, id is uuid, live columns are
--     client_profile_id, created_at, domain, id, name, notes, status, tier,
--     updated_at
--   (note: 20260723_network_tracker.sql still says `priority`; the v3
--    reconcile renamed it to `tier` and that older file is stale. Not load
--    bearing here, but it is why the probe happened.)
--   signal_applications.company_id does NOT exist, so this is real work and
--     not a no-op.
--   234 applications, 14 companies, 67 contacts on dev.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, matching network_contacts.company_id. Removing a company
-- from the networking board must unlink the application, never delete it: the
-- application is tracker data and the board has no business destroying it.
ALTER TABLE public.signal_applications
  ADD COLUMN IF NOT EXISTS company_id uuid
    REFERENCES public.network_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.signal_applications.company_id IS
  'Optional link to a networking board company. NULL means not linked, which is every row before this migration and every row the user declines to link. Never set automatically from a name match; the user confirms every link.';

-- ---------------------------------------------------------------------------
-- 2. The index
-- ---------------------------------------------------------------------------
-- The three new surfaces all ask the same question, "which applications belong
-- to this company", so this is the access path for all of them. Partial: NULL
-- is the overwhelming majority today (234 of 234 rows on dev, 993 of 993 on
-- prod) and nothing ever searches for the unlinked ones by this column.
CREATE INDEX IF NOT EXISTS idx_signal_applications_company
  ON public.signal_applications (company_id)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. The boundary this FK CANNOT enforce
-- ---------------------------------------------------------------------------
-- signal_applications is owned by profile_id and network_companies by
-- client_profile_id, both pointing at client_profiles. A foreign key can only
-- prove the company row EXISTS. It cannot prove it belongs to the same person
-- as the application, so a crafted request could link one user's application to
-- another user's company and the database would accept it.
--
-- A CHECK constraint cannot close this either: it may not reference another
-- table. The candidates are a trigger or app-layer enforcement, and this takes
-- app-layer, consistent with every other network table, where the RLS comment
-- already says "belt-and-suspenders; API is the real guard".
--
-- That decision is only safe if the guard is PROVEN rather than remembered.
-- The API test attempts exactly this cross-profile link and asserts rejection.
-- Same class of hole as the is_coach denylist gap: a boundary that holds only
-- because a route remembers to check needs a test that fails when it forgets.
--
-- Deliberately NOT adding RLS here: signal_applications has none today, the
-- routes use service-role and filter explicitly, and adding a policy to one
-- column of one table would imply a protection the rest of the table does not
-- have.

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- [10/13]  20260805_interview_prep_schema.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec10$ BEGIN RAISE NOTICE '[10/13] applying 20260805_interview_prep_schema'; END $sec10$;

-- Prep Now, commit 1: schema only. ADDITIVE — no behaviour change, no code
-- change, no data migration, no existing column altered in type, default or
-- nullability. Every new column is NULL-able or carries a default, so existing
-- rows stay valid and every current reader keeps working untouched.
--
-- Context (recon 2026-08-05): signal_interviews has no time-of-day and no
-- format. `interview_stage` currently conflates ROUND (hr_screening,
-- final_round, take_home) with MEDIUM (phone, zoom, in_person), so
-- "final round, in person" is unrepresentable. This migration adds the missing
-- axes beside the existing ones rather than reinterpreting them.

-- ---------------------------------------------------------------------------
-- 1. interview_at — the canonical scheduling field
-- ---------------------------------------------------------------------------
-- `interview_date` is a `date`, so an interview at 2pm and one at 9am are
-- indistinguishable, and anything time-relative ("prep 2 hours before") is
-- inexpressible. A `date` also has no instant, which is the root of the
-- day-early rendering bug fixed in lib/localDate.ts; a timestamptz avoids that
-- class entirely.
--
-- interview_date is deliberately NOT dropped, NOT backfilled and NOT altered.
-- It stays as the field every existing reader uses. Backfill and cutover are
-- later commits with their own decisions.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interview_at timestamptz;

COMMENT ON COLUMN public.signal_interviews.interview_at IS
  'Canonical scheduled instant. Supersedes interview_date (date, no time-of-day). Both coexist until cutover; interview_date remains authoritative for existing readers.';

-- ---------------------------------------------------------------------------
-- 2. interview_format — medium, separated from round
-- ---------------------------------------------------------------------------
-- NULL is a real state and the default: it means "not recorded", which is true
-- of every existing row. The CHECK admits NULL explicitly so existing rows pass.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interview_format text;

ALTER TABLE public.signal_interviews
  DROP CONSTRAINT IF EXISTS signal_interviews_interview_format_check;

ALTER TABLE public.signal_interviews
  ADD CONSTRAINT signal_interviews_interview_format_check
  CHECK (interview_format IS NULL OR interview_format IN
    ('in_person','virtual','phone','take_home'));

COMMENT ON COLUMN public.signal_interviews.interview_format IS
  'Medium of the interview, independent of interview_stage (the round). NULL = not recorded.';

-- ---------------------------------------------------------------------------
-- 3. interviewers — structured, alongside the free-text field
-- ---------------------------------------------------------------------------
-- Shape: [{ "name": text, "title": text, "linkedin_url": text }, ...]
-- interviewer_names (text) is NOT dropped and NOT migrated. Two writers for one
-- concept is a known cost, accepted here so this commit stays additive; the
-- reconciliation is its own commit.
--
-- No CHECK on the array shape. A jsonb CHECK cannot express the element schema
-- without a function, and a half-enforced constraint is worse than none —
-- validation belongs at the API boundary.
ALTER TABLE public.signal_interviews
  ADD COLUMN IF NOT EXISTS interviewers jsonb;

COMMENT ON COLUMN public.signal_interviews.interviewers IS
  'Array of {name, title, linkedin_url}. Coexists with interviewer_names (free text); neither is authoritative yet.';

-- ---------------------------------------------------------------------------
-- 4. interview_stage — admit 'ai_hirevue'
-- ---------------------------------------------------------------------------
-- The UI has offered "AI / HireVue" since the tracker was built
-- (app/dashboard/tracker/vocab.ts), but the CHECK from 20260403_job_tracker.sql
-- never included it, so selecting it fails at write time.
--
-- The constraint being dropped was read from pg_constraint on dev before this
-- was written. Verbatim, it is the ONLY check on the table referencing this
-- column:
--
--   signal_interviews_interview_stage_check
--   CHECK ((interview_stage = ANY (ARRAY['hr_screening'::text, 'phone'::text,
--     'zoom'::text, 'in_person'::text, 'take_home'::text, 'final_round'::text,
--     'other'::text])))
--
-- All seven values are preserved below; 'ai_hirevue' is the only addition, and
-- it is placed after 'zoom' to match the order the UI lists them in. A CHECK
-- cannot be altered in place, hence drop and re-add.
--
-- Deliberately NOT `IF EXISTS`: the constraint has been observed, so its
-- absence would mean the database is not in the state this migration was
-- written against, and failing loudly is the correct outcome. `IF EXISTS` here
-- would only buy silence — it would no-op, leave the old narrower constraint in
-- force, and the migration would report success while 'ai_hirevue' still failed.
ALTER TABLE public.signal_interviews
  DROP CONSTRAINT signal_interviews_interview_stage_check;

ALTER TABLE public.signal_interviews
  ADD CONSTRAINT signal_interviews_interview_stage_check
  CHECK (interview_stage IN (
    'hr_screening','phone','zoom','ai_hirevue','in_person',
    'take_home','final_round','other'));

-- ---------------------------------------------------------------------------
-- 5. interview_prep_runs
-- ---------------------------------------------------------------------------
-- One row per generated prep pass for one interview.
--
-- jobfit_run_id is NULLABLE on purpose, not as a convenience: measured on dev,
-- roughly a third of applications carry a signal_score with no jobfit_run_id
-- (coach-sourced jobs copy the score across; rows predating the FK never had
-- one). A prep run must be able to exist with no analysis behind it.
-- ON DELETE SET NULL matches signal_applications.jobfit_run_id, so deleting a
-- run degrades the prep rather than destroying it.
--
-- profile_id is denormalised from the interview so ownership checks and RLS do
-- not need a join. It mirrors signal_interviews, which does the same.
--
-- checklist_state is NOT NULL DEFAULT '{}' because "no items ticked" is a real,
-- representable state and NULL would add a second meaning for the same thing.
-- `generated` is nullable: a row may exist before generation completes.
CREATE TABLE IF NOT EXISTS public.interview_prep_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id     uuid NOT NULL REFERENCES public.signal_interviews(id) ON DELETE CASCADE,
  profile_id       uuid NOT NULL REFERENCES public.client_profiles(id)  ON DELETE CASCADE,
  jobfit_run_id    uuid          REFERENCES public.jobfit_runs(id)      ON DELETE SET NULL,
  content_hash     text,
  generated        jsonb,
  checklist_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_prep_runs_interview_id
  ON public.interview_prep_runs(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_prep_runs_profile_id
  ON public.interview_prep_runs(profile_id);

COMMENT ON COLUMN public.interview_prep_runs.content_hash IS
  'Fingerprint of the inputs a prep was generated from, so an unchanged interview can reuse rather than regenerate.';
COMMENT ON COLUMN public.interview_prep_runs.jobfit_run_id IS
  'Optional. ~1/3 of applications have a score with no run, so prep must work without one.';

-- updated_at maintenance via the existing shared trigger function. Confirmed
-- present on dev before this was written: public.set_updated_at(), no
-- arguments, returns trigger. Same function as
-- trg_positioning_runs_v2_set_updated_at and trg_coach_notes_set_updated_at.
DROP TRIGGER IF EXISTS trg_interview_prep_runs_set_updated_at ON public.interview_prep_runs;
CREATE TRIGGER trg_interview_prep_runs_set_updated_at
  BEFORE UPDATE ON public.interview_prep_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PostgREST caches the schema. Without this the new columns and the widened
-- CHECK are rejected at the API layer even though the database accepts them.
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- [11/13]  20260808_proof_project.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec11$ BEGIN RAISE NOTICE '[11/13] applying 20260808_proof_project'; END $sec11$;

-- 20260808_proof_project.sql
--
-- Proof Project — two columns, no new tables.
--
-- A "proof project" is an ordinary engagement flagged for a different PRESENTATION:
-- the client hub renders it as a journey with unlockable speaking points instead of
-- a plan list. Nothing about the engagement's data model changes, which is the point
-- — the flag is a view selector, not a new kind of engagement. Every existing read
-- (/api/me/activities, the coach's EngagementsTab, the events log) keeps working
-- untouched on a flagged engagement.
--
-- Both columns land on the FROZEN per-client snapshot tables, not the catalog
-- (coach_packages / coach_milestones), because both are per-client facts:
--   - whether THIS client's engagement is their proof project
--   - what THIS client can say once a deliverable is signed off
-- A catalog-level speaking point would be generic copy, which is the opposite of
-- what the feature is for.
--
-- CONSEQUENCE, AND IT IS DELIBERATE: attach_package_to_engagement does not copy
-- either column, so a newly attached package is never a proof project and carries
-- no speaking points until someone sets them. There is no backfill; both defaults
-- are the "off" value. See the note at the bottom about what still has to be built.
--
-- APPLICATION STATE:
--   DEV  (zydrqckpwidipwbhrfgd) — applied 2026-08-08.
--   PROD (ejhnokcnahauvrcbcmic) — applied 2026-08-08, deliberately and by hand,
--   to support the Proof Project dogfood on Aiden's engagement. This was NOT a
--   general opening of the coach-engagement closed gate: it is two additive
--   columns and an index, both defaulting to the inert value, read by nothing
--   that prod was serving at the time. Apply BEFORE
--   20260808_engagement_activity_editing.sql, which depends on speaking_point.

-- ── The flag: is this engagement the client's proof project? ──
--
-- NOT NULL DEFAULT false so every existing row is immediately valid and every
-- existing read that does `select *` is unaffected. There is deliberately NO
-- partial unique index forcing one proof project per relationship: a client CAN
-- have several engagements, the API orders and takes the first, and a DB
-- constraint here would turn a presentation choice into a write-blocking error
-- for a coach who flags a second one.
ALTER TABLE coach_client_engagements
  ADD COLUMN is_proof_project BOOLEAN NOT NULL DEFAULT false;

-- Partial: the page only ever asks for flagged rows, and on any real dataset
-- almost every row is false. Indexing the false side would be dead weight.
CREATE INDEX idx_cce_is_proof_project
  ON coach_client_engagements (coach_client_id)
  WHERE is_proof_project;

-- ── The reward: what the client can say once this deliverable is signed off ──
--
-- Nullable with no default, like every other optional per-client field on these
-- tables (fee_cents, category, due_date). NULL means "this deliverable has no
-- speaking point", which the page treats as a node that completes without
-- revealing a card — not as an empty card, and not as an error.
--
-- Prose, written by the coach, in the CLIENT'S voice: the page labels it
-- "You can now say:" and renders the text directly after that, so copy written in
-- the third person ("the client can discuss…") reads as broken. This is a
-- convention the writing has to hold; there is no way to enforce it in the column.
ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN speaking_point TEXT;

-- ── What this migration does NOT do, so it is not mistaken for finished ──
--
-- Nothing in the product WRITES either column yet. The Proof Project page is
-- read-only by scope, and no coach-side editor was built, so today both are set
-- by hand:
--
--   UPDATE coach_client_engagements
--      SET is_proof_project = true
--    WHERE id = '<engagement uuid>';
--
--   UPDATE coach_client_engagement_deliverables
--      SET speaking_point = 'I rebuilt their onboarding flow and cut drop-off by a third.'
--    WHERE id = '<deliverable uuid>';
--
-- A coach-facing control for both is the obvious next slice.


-- ════════════════════════════════════════════════════════════════════
-- [12/13]  20260808_engagement_activity_editing.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec12$ BEGIN RAISE NOTICE '[12/13] applying 20260808_engagement_activity_editing'; END $sec12$;

-- 20260808_engagement_activity_editing.sql
--
-- Coach-side editing of attached engagements. Two columns and one constraint.
--
-- Runs AFTER 20260808_proof_project.sql (which added is_proof_project and
-- speaking_point). Apply in filename order.
--
-- ── 1. is_signoff: the unlock trigger becomes a PROPERTY, not a POSITION ──
--
-- The Proof Project unlocked a deliverable when its "final coach-owned activity"
-- completed. That rule read the sign-off out of the ORDERING, which was fine
-- while the snapshot was immutable and is not fine now that coaches can reorder,
-- insert and delete activities: dragging a coach task to the end silently moved
-- which task released the client's reward, and nothing on screen said so.
--
-- is_signoff names it instead. Reordering can no longer change the unlock, which
-- is the whole point of this column.
--
-- ── 2. why_this_matters: the coach's framing, beside the client's line ──
--
-- speaking_point is what the CLIENT can say. why_this_matters is why it counts —
-- the coach's voice, shown under the reward once it is unlocked. Nullable, same
-- as speaking_point, and absent is a normal state rather than an empty section.

-- ── why_this_matters ──
ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN why_this_matters TEXT;

-- ── is_signoff ──
ALTER TABLE coach_client_engagement_activities
  ADD COLUMN is_signoff BOOLEAN NOT NULL DEFAULT false;

-- ── BACKFILL: reproduce the old rule exactly, so nothing changes on migrate ──
--
-- The old rule picked the LAST coach-owned activity per deliverable, ordered by
-- (sort_order, created_at). This marks precisely that row. Every deliverable
-- that was unlocked before this migration is still unlocked after it, and every
-- one that was locked is still locked.
--
-- Deliverables with NO coach-owned activity get NO signoff row, which is the
-- same population that fell through to the "all activities complete" fallback
-- before. That fallback is retained in code for exactly this case.
UPDATE coach_client_engagement_activities a
   SET is_signoff = true
  FROM (
    SELECT DISTINCT ON (engagement_deliverable_id) id
      FROM coach_client_engagement_activities
     WHERE owner = 'coach'
     ORDER BY engagement_deliverable_id, sort_order DESC, created_at DESC
  ) pick
 WHERE a.id = pick.id;

-- ── AT MOST ONE SIGN-OFF PER DELIVERABLE ──
--
-- Partial unique index: it constrains only the true rows, so the thousands of
-- false rows cost nothing and are unconstrained.
--
-- It enforces AT MOST one, not EXACTLY one — no index can require a row to
-- exist. Zero is therefore reachable (delete the sign-off, or a deliverable that
-- never had a coach task), and the code treats zero as "fall back to all
-- complete" rather than as "locked forever". The API is what refuses to leave a
-- deliverable at zero where it can avoid it; this index is what makes two
-- impossible.
--
-- Because it is a UNIQUE index, a coach moving the sign-off must clear the old
-- flag and set the new one in ONE statement or a defined order — a naive
-- "set new, then clear old" transiently violates it and will fail. The move
-- endpoint does both sides in a single transaction, old first.
CREATE UNIQUE INDEX uq_ccea_one_signoff_per_deliverable
  ON coach_client_engagement_activities (engagement_deliverable_id)
  WHERE is_signoff;

-- ── What this does NOT change ──
--
-- The catalog (coach_milestones / coach_milestone_activities) is untouched, and
-- attach_package_to_engagement is NOT updated to copy is_signoff: a newly
-- attached package has no sign-off marked and falls back until the coach sets
-- one. Marking sign-offs at the catalog level is a later decision — doing it
-- here would mean editing the RPC in the same migration that changes the read
-- rule, and those two want separate blast radii.
--
-- APPLICATION STATE:
--   DEV  (zydrqckpwidipwbhrfgd) — applied 2026-08-08. Backfill verified against
--   the old positional rule: 0 mismatches, max 1 sign-off per deliverable.
--   PROD (ejhnokcnahauvrcbcmic) — applied 2026-08-08 by hand, after
--   20260808_proof_project.sql. Same verification was run and recorded.
--
-- ORDER MATTERS: this runs SECOND. It assumes speaking_point already exists.


-- ════════════════════════════════════════════════════════════════════
-- [13/13]  20260809_coaching_notes_application_key.sql
-- ════════════════════════════════════════════════════════════════════
DO $sec13$ BEGIN RAISE NOTICE '[13/13] applying 20260809_coaching_notes_application_key'; END $sec13$;

-- 20260809_coaching_notes_application_key.sql
--
-- Re-key coaching notes on the APPLICATION rather than the scoring run.
--
-- WHY. Notes were keyed on jobfit_run_id, so a job typed in by hand — which has
-- no run — could not have notes at all. The UI said "Notes open up once this job
-- has been scored by SIGNAL", which read as a rule about scoring and was really
-- a rule about storage. Every hand-added job hit it, and hand-adding is the path
-- for anything not scanned.
--
-- Removing only the UI gate would have been worse than leaving it: with no run,
-- the POST would write jobfit_run_id = NULL and the GET would query
-- `= NULL`, which in SQL matches nothing. Notes would save and vanish. So the
-- key moves first and the gate comes out last, in its own commit.
--
-- jobfit_run_id STAYS, as provenance and as the fallback read path while
-- confidence builds. Nothing about the existing notes is rewritten.

-- ── 1. The new key ──
--
-- Nullable, because the backfill cannot reach every row (see step 3) and a NOT
-- NULL here would fail the migration on live data. CASCADE because a note about
-- a job has no meaning once the job is gone — and see the note at the bottom
-- about what that does and does not fix.
ALTER TABLE public.coaching_notes
  ADD COLUMN IF NOT EXISTS application_id UUID
    REFERENCES public.signal_applications(id) ON DELETE CASCADE;

-- Mirrors idx_coaching_notes_job_artifact, which is on (jobfit_run_id,
-- artifact_type). Both reads filter on the key AND the artifact type, so the
-- new key needs its own composite or every read after the switch is a scan.
CREATE INDEX IF NOT EXISTS idx_coaching_notes_application_artifact
  ON public.coaching_notes (application_id, artifact_type);

-- ── 2. Backfill ──
--
-- One application per run in practice, but the schema does not guarantee it, so
-- this takes the OLDEST application for a run rather than an arbitrary one. A
-- non-deterministic backfill would be a silent data decision.
UPDATE public.coaching_notes n
   SET application_id = pick.id
  FROM (
    SELECT DISTINCT ON (jobfit_run_id) jobfit_run_id, id
      FROM public.signal_applications
     WHERE jobfit_run_id IS NOT NULL
     ORDER BY jobfit_run_id, created_at ASC
  ) pick
 WHERE n.jobfit_run_id = pick.jobfit_run_id
   AND n.application_id IS NULL;

-- ── 3. Relax the old key ──
--
-- REQUIRED, not cosmetic: jobfit_run_id is NOT NULL today, so a note on a
-- hand-added job — the entire point of this change — cannot be inserted at all
-- while that constraint stands. This is the one part of this migration that is
-- not additive.
ALTER TABLE public.coaching_notes
  ALTER COLUMN jobfit_run_id DROP NOT NULL;

-- ── What this migration does NOT do ──
--
-- ORPHANS ARE LEFT BEHIND, deliberately. A note whose run has no application
-- backfills to NULL and stays unreachable. On prod that is 2 of 2 rows — one
-- reading "Testing coaches notes", one a single line to a client — both already
-- unreachable before this change, since every route resolves
-- application -> run -> notes. Reviewed 2026-08-09 and judged not worth a
-- rescue. Dev has 0.
--
-- IT DOES NOT FIX THE ORPHANING PATH. Deleting an application still destroys
-- the coach notes attached to it — silently, and now via CASCADE rather than by
-- stranding them. That is arguably more honest and still gives nobody any
-- warning. Diagnosed and logged as its own item in
-- docs/silent-write-failures.md ("A third shape: the write survives, the way to
-- reach it does not"). Not fixed here.
--
-- DEV: applied 2026-08-09.
-- PROD: pending. Fifth on the promotion list and last of the five — it is the
-- only one that relaxes a constraint on a table holding live coach-written
-- content, and the only one whose CODE must land in a fixed order relative to
-- it (routes switch first, UI gate comes out last).


-- ── POSTFLIGHT ──────────────────────────────────────────────────────────
-- Assert every artefact actually landed. Without this, a migration that
-- silently no-ops (an IF NOT EXISTS that matched something unexpected)
-- would commit and look like success.
DO $postflight$
DECLARE t text; c record; missing text := ''; n int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['network_companies','network_contacts','network_actions','network_comments','network_client_profile','network_templates','interview_prep_runs'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      missing := missing || format('    table  %s%s', t, chr(10));
    ELSE n := n + 1;
    END IF;
  END LOOP;

  FOR c IN SELECT * FROM (VALUES ('network_contacts','additional_info'),('network_contacts','first_touch_at'),('network_contacts','first_replied_at'),('network_contacts','first_chat_at'),('network_client_profile','seeded_at'),('network_client_profile','touched_fields'),('network_client_profile','resume_seed_attempted_at'),('network_client_profile','help_dismissed'),('signal_applications','company_id'),('signal_interviews','interview_at'),('signal_interviews','interview_format'),('signal_interviews','interviewers'),('coach_client_engagements','is_proof_project'),('coach_client_engagement_deliverables','speaking_point'),('coach_client_engagement_deliverables','why_this_matters'),('coach_client_engagement_activities','is_signoff'),('coaching_notes','application_id')) AS v(tbl, col) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
    ) THEN
      missing := missing || format('    column %s.%s%s', c.tbl, c.col, chr(10));
    ELSE n := n + 1;
    END IF;
  END LOOP;

  -- Section 13's one non-additive change. If this is still NOT NULL, notes
  -- on hand-added jobs cannot be inserted and the re-key silently did nothing.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='coaching_notes'
       AND column_name='jobfit_run_id' AND is_nullable='NO'
  ) THEN
    missing := missing || '    coaching_notes.jobfit_run_id is still NOT NULL' || chr(10);
  ELSE n := n + 1;
  END IF;

  IF missing <> '' THEN
    RAISE EXCEPTION E'POSTFLIGHT FAILED — expected artefacts missing:
%
Rolling back.', missing;
  END IF;

  RAISE NOTICE 'Postflight passed: % artefacts verified.', n;
  RAISE NOTICE 'PROMOTION COMPLETE — 13 migrations applied in one transaction.';
END
$postflight$;

COMMIT;

-- ── Confirmation (runs after COMMIT; read-only) ─────────────────────────
SELECT 'table' AS kind, t AS name, (to_regclass('public.' || t) IS NOT NULL) AS ok
  FROM unnest(ARRAY['network_companies','network_contacts','network_actions','network_comments','network_client_profile','network_templates','interview_prep_runs']) AS t
UNION ALL
SELECT 'column', v.tbl || '.' || v.col,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=v.tbl AND column_name=v.col)
  FROM (VALUES ('network_contacts','additional_info'),('network_contacts','first_touch_at'),('network_contacts','first_replied_at'),('network_contacts','first_chat_at'),('network_client_profile','seeded_at'),('network_client_profile','touched_fields'),('network_client_profile','resume_seed_attempted_at'),('network_client_profile','help_dismissed'),('signal_applications','company_id'),('signal_interviews','interview_at'),('signal_interviews','interview_format'),('signal_interviews','interviewers'),('coach_client_engagements','is_proof_project'),('coach_client_engagement_deliverables','speaking_point'),('coach_client_engagement_deliverables','why_this_matters'),('coach_client_engagement_activities','is_signoff'),('coaching_notes','application_id')) AS v(tbl, col)
ORDER BY kind, name;
