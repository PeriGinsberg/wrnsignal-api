-- 20260723_network_tracker_v3_reconcile.sql
-- Migration 2 — reconcile the Network Tracker to WRN Tracker v3.
-- See docs/network-tracker/network-tracker-reconciliation.md. Supersedes the
-- pipeline/interval shape of migration 1 (20260723_network_tracker.sql).
--
-- CLEAN RE-DROP: dev is disposable and there is no data to preserve, so this
-- drops all network_* tables and recreates them at the v3 shape rather than
-- ALTERing. Re-runnable. Reseed with scripts/seed-network-fixture.ts afterward.
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
