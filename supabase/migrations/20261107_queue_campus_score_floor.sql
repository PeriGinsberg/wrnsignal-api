-- 20261107_queue_campus_score_floor.sql
-- A campus posting scoring below 40 ranks in "timing unknown", not "campus".
--
-- Coach review 2026-10-26: the bottom of Alex's campus tier was postings the
-- judge scored 3 to 35 (construction project managers, an attorney role, an
-- engineering new-grad role in Los Angeles), ranked above every non-campus
-- posting, including M&A analyst roles scoring 85 to 90. Campus status orders
-- the queue only when the posting is also a reasonable fit.
--
--   future_start   Tier 1 "campus": campus_signal = true AND score >= 40.
--                  Tier 2 "timing unknown": everything else, including
--                  unjudged campus postings (score NULL).
--   available_now  unchanged.
--
-- Same view as 20261106_queue_timing_tiers.sql otherwise. Requires it. Same
-- file for dev and prod. One transaction.

BEGIN;

DROP VIEW IF EXISTS public.client_match_queue;

CREATE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    q.*,
    row_number() OVER (
      PARTITION BY q.client_profile_id
      ORDER BY q.tier, q.score DESC NULLS LAST, q.republished_only, q.first_queued_at DESC
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
      p.apply_url,
      p.years_min, p.years_max, p.years_basis,
      p.salary_low, p.salary_high, p.salary_period,
      p.application_deadline,
      p.requirements_summary,
      p.posted_at,
      p.first_seen_at,
      p.last_seen_at,
      p.start_type, p.start_date, p.start_season, p.start_year, p.start_text,
      p.employment_types,
      CASE p.start_type
        WHEN 'date' THEN 'starts ' || to_char(p.start_date, 'YYYY-MM-DD')
        WHEN 'season' THEN 'starts ' || p.start_season || ' ' || p.start_year
        WHEN 'immediate' THEN 'starts immediately'
        ELSE 'start not stated'
      END AS start_label,
      p.campus_signal,
      p.apply_link_kind,
      coalesce(p.apply_link_kind IN ('republisher', 'other', 'google'), false) AS republished_only,
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
      END AS tier_label
    FROM public.posting_matches m
    JOIN public.client_match_criteria c ON c.client_profile_id = m.client_profile_id AND c.active
    JOIN public.postings_canonical p ON p.id = m.posting_id
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
      AND m.action IS NULL
      AND p.last_seen_at > now() - interval '14 days'
  ) q;
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules and were seen in the last 14 days. Ranked in timing tiers (see 20261106_queue_timing_tiers.sql, 20261107_queue_campus_score_floor.sql): a client whose available_from is in the future gets campus postings scoring 40 or more first, then "timing unknown"; a client available now gets postings starting now, within 3 months or not stated first, then "starts in 3+ months". Within a tier: best score first, unjudged last, republished-only below others at equal score. Nothing hidden. is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify (one row, every column true)
-- ---------------------------------------------------------------------------
-- SELECT
--   NOT EXISTS (SELECT 1 FROM public.client_match_queue WHERE tier = 1 AND timing_mode = 'future_start' AND (score IS NULL OR score < 40)) AS no_low_campus_in_tier1,
--   NOT EXISTS (SELECT 1 FROM public.client_match_queue WHERE tier = 2 AND timing_mode = 'future_start' AND campus_signal AND score >= 40) AS no_fit_campus_in_tier2,
--   NOT EXISTS (
--     SELECT 1 FROM public.client_match_queue a JOIN public.client_match_queue b
--       ON a.client_profile_id = b.client_profile_id AND a.tier < b.tier AND a.rank > b.rank
--   ) AS tiers_in_rank_order;
