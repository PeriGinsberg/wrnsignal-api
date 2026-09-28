-- Practice rounds: a coach asks a few interview questions, the client records
-- an answer to each, the coach watches them back.
--
-- DELIBERATELY NOT PART OF WORKBOOKS. A workbook is a document the two of them
-- fill in together and freeze; a practice round is a short request-and-reply
-- with media attached. They share a client and a coach and nothing else, and
-- wiring them together now would mean every workbook migration had to reason
-- about recordings. The only link is the coach task that suggests building one.
--
-- STAGING FIRST. Applied to the dev project (zydrqckpwidipwbhrfgd) which is
-- what wrnsignal-api-staging points at. Nothing here touches prod.

-- ── Rounds ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.practice_rounds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id   uuid NOT NULL REFERENCES public.coach_clients(id) ON DELETE CASCADE,
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  coach_profile_id  uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  title             text NOT NULL DEFAULT 'Practice round',
  -- draft: the coach is still building it and the client cannot see it.
  -- sent: the client has been emailed and can record.
  -- submitted: the client pressed submit. Still readable, no longer editable.
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'submitted')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  submitted_at      timestamptz,
  deleted_at        timestamptz
);

CREATE INDEX IF NOT EXISTS practice_rounds_coach_client_idx
  ON public.practice_rounds (coach_client_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS practice_rounds_client_idx
  ON public.practice_rounds (client_profile_id, created_at DESC) WHERE deleted_at IS NULL;

-- ── Questions ─────────────────────────────────────────────────────────────
-- `position` is the display order and is rewritten wholesale on reorder, which
-- is simpler than gap-keeping and fine at five questions.
CREATE TABLE IF NOT EXISTS public.practice_questions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id   uuid NOT NULL REFERENCES public.practice_rounds(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  text       text NOT NULL CHECK (length(btrim(text)) > 0),
  -- Where it came from, for nothing more than curiosity later.
  source     text NOT NULL DEFAULT 'custom' CHECK (source IN ('bank', 'custom')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_questions_round_idx
  ON public.practice_questions (round_id, position);

-- ── Takes ─────────────────────────────────────────────────────────────────
-- One row per recording. A question can hold several: re-recording keeps the
-- earlier attempts rather than destroying them, and the newest is the answer.
CREATE TABLE IF NOT EXISTS public.practice_takes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     uuid NOT NULL REFERENCES public.practice_rounds(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES public.practice_questions(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime         text NOT NULL DEFAULT 'video/webm',
  duration_ms  integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_takes_question_idx
  ON public.practice_takes (question_id, created_at DESC);

-- ── Row level security ────────────────────────────────────────────────────
-- Both sides read through the service role in the API layer, which is the
-- pattern the rest of the coach surface uses, so these policies exist to make
-- the tables safe by default rather than to be the access path.
ALTER TABLE public.practice_rounds    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_takes     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS practice_rounds_own ON public.practice_rounds;
CREATE POLICY practice_rounds_own ON public.practice_rounds
  FOR SELECT TO authenticated
  USING (client_profile_id = auth.uid() OR coach_profile_id = auth.uid());

DROP POLICY IF EXISTS practice_questions_own ON public.practice_questions;
CREATE POLICY practice_questions_own ON public.practice_questions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.practice_rounds r
    WHERE r.id = round_id
      AND (r.client_profile_id = auth.uid() OR r.coach_profile_id = auth.uid())
  ));

DROP POLICY IF EXISTS practice_takes_own ON public.practice_takes;
CREATE POLICY practice_takes_own ON public.practice_takes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.practice_rounds r
    WHERE r.id = round_id
      AND (r.client_profile_id = auth.uid() OR r.coach_profile_id = auth.uid())
  ));

-- ── Recordings bucket ─────────────────────────────────────────────────────
-- PRIVATE. Every read goes through a short-lived signed URL minted by the API
-- for someone who is already on the round. A public bucket would make a
-- client's practice answers guessable by path.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'practice-takes', 'practice-takes', false,
  104857600, -- 100 MB. 90 seconds of VP8/VP9 at a sane bitrate lands around
             -- 15-30 MB; the headroom is for a device that ignores the
             -- bitrate hint, and the recorder caps itself long before this.
  ARRAY['video/webm', 'video/mp4', 'video/quicktime', 'audio/webm', 'audio/mp4']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public = false;
