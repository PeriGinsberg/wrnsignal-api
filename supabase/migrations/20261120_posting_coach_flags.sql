-- 20261120_posting_coach_flags.sql
-- Job Queue (2 of 4): a coach's flag on a posting, and the queue that honours it.
--
-- posting_coach_flags   one row per posting a coach marked from the Job Queue:
--   flag 'closed'       the job is closed: out of every client's queue
--   flag 'not_us'       the job is not in the US: out of every client's queue
--   flag 'bad_link'     the apply link is wrong: stays, ranked below the rest
--                       of its tier until a coach saves a working link
--   apply_url           a link the coach found ("Save URL"): used for every
--                       client, ahead of the market link and the posting's own
-- A separate table, not postings columns: an update to postings fires
-- postings_touch_last_seen, which would count the coach's click as a new
-- sighting on the job board; and postings_canonical (SELECT p.*) would have to
-- be rebuilt to carry new columns.
--
-- client_match_queue changes:
--   * an 'evaluating' match (Add Job opened, not finished) stays in the queue
--   * closed / not_us flags leave it; bad_link ranks after likely_closed
--   * apply_url = coalesce(coach link, client's market link, posting's link)
--   * new columns at the end: match_id, action, coach_flag, coach_apply_url,
--     bad_link, raw_title
-- Dropped and recreated: columns are added in the middle of the inner select.
-- Nothing else depends on the view.
--
-- Requires 20261119_queue_rank_unchecked_links.sql and
-- 20261120_job_queue_matches.sql. Same file for dev and prod. One transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.posting_coach_flags (
  posting_id uuid PRIMARY KEY REFERENCES public.postings (id) ON DELETE CASCADE,
  flag text,
  apply_url text,
  flagged_at timestamptz,
  flagged_by uuid REFERENCES public.client_profiles (id) ON DELETE SET NULL,
  url_saved_at timestamptz,
  url_saved_by uuid REFERENCES public.client_profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posting_coach_flags_flag_known CHECK (flag IS NULL OR flag IN ('closed', 'bad_link', 'not_us')),
  CONSTRAINT posting_coach_flags_flag_time CHECK ((flag IS NULL) = (flagged_at IS NULL)),
  CONSTRAINT posting_coach_flags_url_shape CHECK (apply_url IS NULL OR apply_url ~* '^https?://'),
  CONSTRAINT posting_coach_flags_url_time CHECK ((apply_url IS NULL) = (url_saved_at IS NULL)),
  CONSTRAINT posting_coach_flags_not_empty CHECK (flag IS NOT NULL OR apply_url IS NOT NULL)
);
ALTER TABLE public.posting_coach_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.posting_coach_flags FROM anon, authenticated;
COMMENT ON TABLE public.posting_coach_flags IS
  'Job Queue flags on a posting, for every client: closed / not_us take it out of client_match_queue, bad_link ranks it last in its tier; apply_url is a coach-found link used ahead of every other.';

DROP VIEW IF EXISTS public.client_match_queue;

CREATE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    q.*,
    row_number() OVER (
      PARTITION BY q.client_profile_id
      ORDER BY q.likely_closed, q.bad_link, q.tier, q.score DESC NULLS LAST, q.preferred_market DESC, q.republished_only, q.first_queued_at DESC
    ) AS rank
  FROM (
    SELECT
      m.client_profile_id,
      m.posting_id,
      m.score,
      m.judge_reason,
      m.judge_evidence,
      m.first_queued_at,
      (m.first_queued_at > coalesce(c.last_reviewed_at, '-infinity'::timestamptz)) AS is_new,
      p.source,
      coalesce(p.cleaned_title, p.title) AS title,
      p.company,
      p.location,
      coalesce(f.apply_url, m.apply_url, p.apply_url) AS apply_url,
      (m.apply_url IS NOT NULL AND f.apply_url IS NULL) AS market_link,
      p.years_min, p.years_max, p.years_basis,
      p.salary_low, p.salary_high, p.salary_period,
      p.application_deadline,
      p.requirements_summary,
      p.required_majors, p.majors_basis,
      p.posted_at,
      p.first_seen_at,
      p.last_seen_at,
      p.link_checked_at, p.link_check_status,
      (p.link_check_status IS NOT DISTINCT FROM 'likely_closed') AS likely_closed,
      m.preferred_market,
      p.start_type, p.start_date, p.start_season, p.start_year, p.start_text,
      p.employment_types,
      CASE p.start_type
        WHEN 'date' THEN 'starts ' || to_char(p.start_date, 'YYYY-MM-DD')
        WHEN 'season' THEN 'starts ' || p.start_season || ' ' || p.start_year
        WHEN 'immediate' THEN 'starts immediately'
        ELSE 'start not stated'
      END AS start_label,
      p.campus_signal,
      -- A coach-saved link is the employer's own page as far as ranking goes.
      CASE WHEN f.apply_url IS NOT NULL THEN 'employer' ELSE coalesce(m.apply_link_kind, p.apply_link_kind) END AS apply_link_kind,
      CASE WHEN f.apply_url IS NOT NULL THEN false
           ELSE coalesce(coalesce(m.apply_link_kind, p.apply_link_kind) IN ('republisher', 'other', 'google'), false) END AS republished_only,
      c.available_from,
      t.timing_mode,
      CASE
        WHEN t.timing_mode = 'future_start' THEN CASE WHEN p.campus_signal AND m.score >= 40 THEN 1 ELSE 2 END
        WHEN t.stated_start > current_date + interval '3 months' THEN 2
        ELSE 1
      END::smallint AS tier,
      CASE
        WHEN t.timing_mode = 'future_start' THEN CASE WHEN p.campus_signal AND m.score >= 40 THEN 'campus' ELSE 'timing unknown' END
        WHEN t.stated_start > current_date + interval '3 months' THEN 'starts in 3+ months'
        ELSE 'now or not stated'
      END AS tier_label,
      m.id AS match_id,
      m.action,
      f.flag AS coach_flag,
      f.apply_url AS coach_apply_url,
      (f.flag IS NOT DISTINCT FROM 'bad_link' AND f.apply_url IS NULL) AS bad_link,
      -- The title as found: cleaning drops store and requisition numbers,
      -- which the Job Queue's grouping must still see (lib/ingest/linkV2.ts).
      p.title AS raw_title
    FROM public.posting_matches m
    JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
    JOIN public.postings_canonical p ON p.id = m.posting_id
    LEFT JOIN public.posting_coach_flags f ON f.posting_id = m.posting_id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN c.available_from > current_date THEN 'future_start' ELSE 'available_now' END AS timing_mode,
        CASE p.start_type
          WHEN 'date' THEN p.start_date
          WHEN 'season' THEN make_date(p.start_year,
            CASE p.start_season WHEN 'spring' THEN 3 WHEN 'summer' THEN 6 WHEN 'fall' THEN 9 ELSE 1 END, 1)
        END AS stated_start
    ) t
    WHERE cardinality(m.rule_failures) = 0
      AND (m.action IS NULL OR m.action = 'evaluating')
      AND p.last_seen_at > now() - interval '14 days'
      AND p.closed_at IS NULL
      AND (f.flag IS NULL OR f.flag = 'bad_link')
  ) q;
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: undecided postings (no action, or evaluating: Add Job opened) that pass the client''s hard rules, were seen in the last 14 days, are not closed (link check) and not flagged closed or not in the US by a coach (posting_coach_flags). Ranked in timing tiers (20261106, 20261107): a client whose available_from is in the future gets campus postings scoring 40 or more first, then "timing unknown"; a client available now gets postings starting now, within 3 months or not stated first, then "starts in 3+ months". Within a tier: best score first, unjudged last; at equal score a preferred-market posting first, then republished-only below others. likely_closed (link check), then a coach bad_link flag with no saved link, rank below every tier. apply_url is the coach''s saved link, else the client''s market link (market_link), else the posting''s. is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'flags table' AS check, to_regclass('public.posting_coach_flags') IS NOT NULL AS ok
-- UNION ALL SELECT 'view has match_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'match_id')
-- UNION ALL SELECT 'view keeps evaluating', pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%evaluating%'
-- UNION ALL SELECT 'view hides flagged', pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%bad_link%'
-- UNION ALL SELECT 'same queue size as before (no flags yet)',
--   (SELECT count(*) FROM public.client_match_queue) = (SELECT count(*) FROM public.posting_matches m JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
--      JOIN public.postings_canonical p ON p.id = m.posting_id WHERE cardinality(m.rule_failures) = 0 AND m.action IS NULL AND p.last_seen_at > now() - interval '14 days' AND p.closed_at IS NULL);
