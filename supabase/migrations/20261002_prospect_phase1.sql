-- Prospect workflow, Phase 1. 2026-10-02.
--
-- IN PLAIN ENGLISH
--
-- 1. A prospect can carry a parent or guardian's contact (name, email, phone)
--    and, when they came through a friend, family member or past client, who
--    referred them (name, optional email). Target industries joins the target
--    roles and locations already kept.
-- 2. Lead source gets new options: a friend or family member, a past client of
--    Peri's, a Facebook group or online community, Instagram or TikTok, Google
--    search, an ad, a free guide or resource, or Other (with the specify text in
--    the existing source_detail). The five old values stay valid so existing
--    prospects keep theirs; the app no longer offers them.
-- 3. A lost prospect records why (not a fit, price, timing, chose another
--    option, no response, or other with text), any notes, and when. Reopening
--    clears them on the record; History keeps what they were.
-- 4. prospect_consults: one row per prospect, holding the consult call's date,
--    the notes taken during it, and its outcome. Saving it makes it the record
--    of the consult; the values it replaced are written to History by the app.
--
-- Additive: new nullable columns, a widened CHECK, a new table. Nothing reads
-- them until the app does. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS prospect_consults;
--   ALTER TABLE coach_clients
--     DROP COLUMN IF EXISTS parent_name, DROP COLUMN IF EXISTS parent_email,
--     DROP COLUMN IF EXISTS parent_phone, DROP COLUMN IF EXISTS referred_by_name,
--     DROP COLUMN IF EXISTS referred_by_email, DROP COLUMN IF EXISTS target_industries,
--     DROP COLUMN IF EXISTS lost_reason, DROP COLUMN IF EXISTS lost_reason_detail,
--     DROP COLUMN IF EXISTS lost_notes, DROP COLUMN IF EXISTS lost_at;
--   (and restore the old source_category CHECK, after re-mapping any rows that
--    hold a new value)

-- ---------------------------------------------------------------------------
-- 1. Contact, referral and targeting
-- ---------------------------------------------------------------------------
ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS parent_name        TEXT,
  ADD COLUMN IF NOT EXISTS parent_email       TEXT,
  ADD COLUMN IF NOT EXISTS parent_phone       TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_name   TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_email  TEXT,
  ADD COLUMN IF NOT EXISTS target_industries  TEXT;

-- ---------------------------------------------------------------------------
-- 2. Lead source: the new options, with the old ones still valid
-- ---------------------------------------------------------------------------
-- The original constraint was declared inline on the column, so Postgres named
-- it coach_clients_source_category_check.
ALTER TABLE coach_clients DROP CONSTRAINT IF EXISTS coach_clients_source_category_check;
ALTER TABLE coach_clients
  ADD CONSTRAINT coach_clients_source_category_check
  CHECK (source_category IS NULL OR source_category IN (
    'friend_family', 'past_client', 'online_community', 'instagram_tiktok',
    'google_search', 'ad', 'free_resource', 'other',
    -- before 2026-10-02
    'referral', 'social_media', 'website', 'personal_contact'
  ));

-- ---------------------------------------------------------------------------
-- 3. Lost
-- ---------------------------------------------------------------------------
ALTER TABLE coach_clients
  ADD COLUMN IF NOT EXISTS lost_reason        TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason_detail TEXT,
  ADD COLUMN IF NOT EXISTS lost_notes         TEXT,
  ADD COLUMN IF NOT EXISTS lost_at            TIMESTAMPTZ;

ALTER TABLE coach_clients DROP CONSTRAINT IF EXISTS coach_clients_lost_reason_valid;
ALTER TABLE coach_clients
  ADD CONSTRAINT coach_clients_lost_reason_valid
  CHECK (lost_reason IS NULL OR lost_reason IN
    ('not_a_fit', 'price', 'timing', 'chose_other', 'no_response', 'other'));

-- ---------------------------------------------------------------------------
-- 4. The consult
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prospect_consults (
  coach_client_id       UUID PRIMARY KEY REFERENCES coach_clients(id) ON DELETE CASCADE,
  scheduled_for         DATE,
  why_now               TEXT,
  search_goal           TEXT,
  search_goal_other     TEXT,
  services              TEXT[] NOT NULL DEFAULT '{}',
  timeline_deadlines    TEXT,
  timeline_start        TEXT,
  timeline_season       TEXT,
  tried_so_far          TEXT,
  material_resume       TEXT,
  material_linkedin     TEXT,
  material_cover_letter TEXT,
  recommendation        TEXT,
  next_steps            TEXT,
  outcome               TEXT,
  outcome_at            TIMESTAMPTZ,
  minutes_logged        INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prospect_consults_search_goal_valid CHECK (search_goal IS NULL OR search_goal IN
    ('internship', 'first_job', 'early_career_change', 'seasoned_change', 'other')),
  CONSTRAINT prospect_consults_services_valid CHECK (services <@ ARRAY[
    'early_career_planning', 'resume_cover_letter', 'linkedin', 'networking_strategy',
    'interview_coaching', 'confidence_building', 'job_search_support', 'all']::TEXT[]),
  CONSTRAINT prospect_consults_materials_valid CHECK (
    (material_resume IS NULL OR material_resume IN ('have', 'needs_work', 'none')) AND
    (material_linkedin IS NULL OR material_linkedin IN ('have', 'needs_work', 'none')) AND
    (material_cover_letter IS NULL OR material_cover_letter IN ('have', 'needs_work', 'none'))),
  CONSTRAINT prospect_consults_outcome_valid CHECK (outcome IS NULL OR outcome IN
    ('completed', 'no_show', 'not_a_fit')),
  CONSTRAINT prospect_consults_minutes_valid CHECK (minutes_logged IS NULL OR minutes_logged BETWEEN 0 AND 1440)
);

DROP TRIGGER IF EXISTS trg_prospect_consults_set_updated_at ON prospect_consults;
CREATE TRIGGER trg_prospect_consults_set_updated_at
  BEFORE UPDATE ON prospect_consults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Service role only, like every coach table: the app's routes are the gate.
ALTER TABLE prospect_consults ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON prospect_consults TO service_role;

-- ---------------------------------------------------------------------------
-- Verification. Run these after.
-- ---------------------------------------------------------------------------
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'coach_clients'
--     AND column_name IN ('parent_name','referred_by_name','target_industries','lost_reason','lost_at');
--   -- five rows
--   SELECT to_regclass('public.prospect_consults');   -- not null
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'coach_clients_source_category_check';  -- lists friend_family … personal_contact
