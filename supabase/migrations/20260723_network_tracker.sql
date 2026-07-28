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
