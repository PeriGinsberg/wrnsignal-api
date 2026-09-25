-- ═══════════════════════════════════════════════════
-- Networking Campaign Briefs, and what they drive — 2026-09-27
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- A Networking Campaign starts with a brief: who this client is, what they
-- want, and anything Erin needs to know before building the list. Submitting
-- one starts a chain of four tasks, and the plan that eventually gets built
-- belongs to that brief.
--
-- A BRIEF IS A SNAPSHOT, NOT A VIEW OF THE PROFILE. Its fields are prefilled
-- from client_profiles where those are populated, and from an AI read of
-- profile_text where they are not, but once saved the brief owns its values and
-- nothing writes back. A client's targets legitimately change between
-- campaigns; a brief that silently followed the profile would rewrite the
-- history of what was asked for, and the plan built from it would stop
-- matching the brief it came from.
--
-- WHY PRIMARY AND SECONDARY ARE SEPARATE COLUMNS. client_profiles.target_roles
-- is one field, and app/api/profile/route.ts parses "Primary Roles:" up to
-- "Secondary Roles:" and throws the secondary half away. The brief is where
-- that distinction is finally kept, which is also why prefill can only ever
-- populate the primary side from the profile.
--
-- Reversibility:
--   ALTER TABLE coach_tasks DROP COLUMN brief_id;
--   ALTER TABLE networking_plan_jobs DROP COLUMN brief_id;
--   ALTER TABLE networking_plan_sources DROP COLUMN brief_id;
--   DROP TABLE networking_campaign_briefs;

CREATE TABLE IF NOT EXISTS public.networking_campaign_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A brief belongs to a coach-client relationship, like the plan it drives.
  coach_client_id   UUID NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  client_profile_id UUID NOT NULL REFERENCES public.client_profiles(id),

  -- A client has many briefs over time. The name is how a coach tells the
  -- spring campaign from the autumn one.
  name TEXT NOT NULL,

  -- draft: being written, nothing has happened.
  -- submitted: the chain has started. A submitted brief is not edited, because
  --            Erin may already be working from it.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted')),

  education_status TEXT,
  immediate_goals  TEXT,

  -- Arrays rather than comma-joined text. The profile stores these as prose
  -- and it is why nothing can filter on them; a brief is a fresh start.
  primary_roles        TEXT[] NOT NULL DEFAULT '{}',
  secondary_roles      TEXT[] NOT NULL DEFAULT '{}',
  primary_industries   TEXT[] NOT NULL DEFAULT '{}',
  secondary_industries TEXT[] NOT NULL DEFAULT '{}',
  locations            TEXT[] NOT NULL DEFAULT '{}',

  notes_for_builder TEXT,

  -- What the AI read out of profile_text, kept beside what the coach settled
  -- on. Not the brief's values: a suggestion the coach rejected is worth
  -- knowing about when the same extraction looks wrong again.
  ai_suggestions JSONB,

  -- Which fields the prefill filled, so the UI can mark them and a later
  -- reader can tell "the coach typed this" from "the profile said this".
  prefilled_fields TEXT[] NOT NULL DEFAULT '{}',

  submitted_at    TIMESTAMPTZ,
  submitted_by_id UUID REFERENCES public.client_profiles(id),
  created_by_id   UUID REFERENCES public.client_profiles(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,

  -- submitted_at and status cannot disagree.
  CONSTRAINT briefs_submitted_at_matches_status
    CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

-- "This client's briefs, newest first" is the history list.
CREATE INDEX IF NOT EXISTS idx_briefs_client
  ON public.networking_campaign_briefs (client_profile_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- "The most recent open campaign", which is what an import defaults to.
CREATE INDEX IF NOT EXISTS idx_briefs_open
  ON public.networking_campaign_briefs (coach_client_id, submitted_at DESC)
  WHERE deleted_at IS NULL AND status = 'submitted';

ALTER TABLE public.networking_campaign_briefs ENABLE ROW LEVEL SECURITY;
-- Service role only, like the plan tables beside it. The routes do their own
-- scope check; RLS on with no policy denies anon and authenticated outright.

-- ---------------------------------------------------------------------------
-- What the brief is attached to
-- ---------------------------------------------------------------------------

-- The task rows in this brief's chain. Null for every task that is not part of
-- a networking campaign, which is most of them.
ALTER TABLE public.coach_tasks
  ADD COLUMN IF NOT EXISTS brief_id UUID REFERENCES public.networking_campaign_briefs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coach_tasks_brief
  ON public.coach_tasks (brief_id)
  WHERE deleted_at IS NULL AND brief_id IS NOT NULL;

-- Which campaign a built plan belongs to, and which campaign an uploaded list
-- was for. The import asks; this is where the answer goes.
ALTER TABLE public.networking_plan_jobs
  ADD COLUMN IF NOT EXISTS brief_id UUID REFERENCES public.networking_campaign_briefs(id) ON DELETE SET NULL;

ALTER TABLE public.networking_plan_sources
  ADD COLUMN IF NOT EXISTS brief_id UUID REFERENCES public.networking_campaign_briefs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_plan_jobs_brief
  ON public.networking_plan_jobs (brief_id)
  WHERE brief_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Task decisions
-- ---------------------------------------------------------------------------
-- "Review Networking Campaign" is completed by pressing Approve or Request
-- Changes rather than by ticking a box, and the rules downstream branch on
-- which. The decision rides on the automation event, and is recorded here too
-- so the task itself can say how it was closed.
ALTER TABLE public.coach_tasks
  ADD COLUMN IF NOT EXISTS decision TEXT;

NOTIFY pgrst, 'reload schema';
