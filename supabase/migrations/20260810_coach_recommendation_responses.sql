-- 20260810_coach_recommendation_responses.sql
--
-- Append-only log of a client's answers to coach-sourced jobs.
--
-- WHY A TABLE. coach_job_recommendations.client_status is a single column with
-- a single client_responded_at. Answering "Interested" and later "Not
-- interested" UPDATEs that row, so the first answer and the fact that the
-- client changed their mind are not hidden — they are never recorded. The job
-- History timeline could only ever show the latest answer.
--
-- Changing one's mind about a job a coach sent is exactly the kind of thing a
-- coach needs to see, and a log that silently rewrites itself is not a log.
-- This table is the record; client_status stays as the CURRENT-STATE field the
-- banner filter, the hub's Required Actions and the coach's client page all
-- read. Two different questions, two different shapes:
--
--   coach_job_recommendations.client_status   what the answer is NOW
--   coach_recommendation_responses            every answer, in order
--
-- APPEND ONLY. Nothing in the app updates or deletes a row here. If that ever
-- changes, this stops being a record and the History timeline goes back to
-- lying by omission.

CREATE TABLE IF NOT EXISTS public.coach_recommendation_responses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id  UUID NOT NULL
                       REFERENCES public.coach_job_recommendations(id) ON DELETE CASCADE,
  client_profile_id  UUID NOT NULL
                       REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  -- Denormalised from the recommendation, because the History timeline reads by
  -- application and joining through the parent on every load buys nothing. It
  -- is NULLABLE because 5 production recommendations have no application_id;
  -- those cannot be answered through the UI today (there is no detail page to
  -- host the box) but the endpoint is reachable and must not fail on them.
  application_id     UUID REFERENCES public.signal_applications(id) ON DELETE CASCADE,
  -- The answer as given. Deliberately NOT constrained to the parent's CHECK
  -- list: this is a historical record, and if the allowed vocabulary changes
  -- later, rows written under the old vocabulary are still what happened.
  client_status      TEXT NOT NULL,
  responded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The timeline reads by application, oldest first. Matches that exactly.
CREATE INDEX IF NOT EXISTS idx_coach_rec_responses_application
  ON public.coach_recommendation_responses (application_id, responded_at);

-- For the recommendation-centric view (a coach looking at one rec's history).
CREATE INDEX IF NOT EXISTS idx_coach_rec_responses_recommendation
  ON public.coach_recommendation_responses (recommendation_id, responded_at);

ALTER TABLE public.coach_recommendation_responses ENABLE ROW LEVEL SECURITY;

-- Mirrors coach_job_recommendations' own policy: the client who answered, or a
-- coach on that recommendation, may read it.
--
-- Defence in depth only. Every route that touches this table uses the service
-- role, which bypasses RLS entirely; the real boundary is the ownership check
-- in the route. The policy is here so the table is not readable by a stray
-- anon-key client, and so it does not become the second table in this schema
-- with RLS enabled and no policy at all.
CREATE POLICY "clients_and_coaches_see_responses"
  ON public.coach_recommendation_responses FOR ALL
  USING (
    client_profile_id = (SELECT id FROM public.client_profiles WHERE user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.coach_job_recommendations r
       WHERE r.id = coach_recommendation_responses.recommendation_id
         AND r.coach_profile_id = (SELECT id FROM public.client_profiles WHERE user_id = auth.uid())
    )
  );

COMMENT ON TABLE public.coach_recommendation_responses IS
  'APPEND-ONLY. One row per answer a client gives to a coach-sourced job. '
  'Never updated, never deleted by the app. coach_job_recommendations.client_status '
  'holds the CURRENT answer; this holds all of them, so "changed their mind" is '
  'visible on the job History rather than overwritten.';

-- NO BACKFILL, and there is nothing to backfill from. Answers given before
-- 2026-08-10 were never dated: client_responded_at was 0 of 131 rows on prod.
-- A row here invented from client_status would carry a fabricated timestamp,
-- which is worse than an absent one. Jobs answered before today simply have no
-- response event on their timeline.

-- DEV:  applied 2026-08-10.
-- PROD: pending, with the code deploy. Additive and safe to run BEFORE the
-- deploy — unlike 20260810_reset_bulk_dismissed_recommendations.sql, which must
-- run after it.
