-- 20261119_queue_rank_unchecked_links.sql
--
-- FIX: client_match_queue ranked every link-checked posting above every
-- unchecked one, whatever the score.
--
-- likely_closed was (p.link_check_status = 'likely_closed'), which is NULL for
-- a posting the link check has not reached. The rank sorts on likely_closed
-- first, ascending, and ascending puts NULLs last: so the 30-111 checked rows of
-- each client (false) came first, scores 52 down to 0, and the unchecked rest
-- (null) after them, best scores (78-96) included. Found 2026-11-02 on all nine
-- active clients (Gabe: his 88, a Project Coordinator in Montgomeryville, PA, at
-- rank 53 under a 12). It also held itself in place: the link check reads the
-- top of each queue, which was always the same checked rows.
--
-- Now IS NOT DISTINCT FROM: false unless the check said likely_closed. Same
-- column, same type; only that expression changes, so CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE VIEW public.client_match_queue
WITH (security_invoker = true) AS
  SELECT
    q.*,
    row_number() OVER (
      PARTITION BY q.client_profile_id
      ORDER BY q.likely_closed, q.tier, q.score DESC NULLS LAST, q.preferred_market DESC, q.republished_only, q.first_queued_at DESC
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
      coalesce(m.apply_url, p.apply_url) AS apply_url,
      (m.apply_url IS NOT NULL) AS market_link,
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
      coalesce(m.apply_link_kind, p.apply_link_kind) AS apply_link_kind,
      coalesce(coalesce(m.apply_link_kind, p.apply_link_kind) IN ('republisher', 'other', 'google'), false) AS republished_only,
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
      AND p.closed_at IS NULL
  ) q;
REVOKE ALL ON public.client_match_queue FROM anon, authenticated;
COMMENT ON VIEW public.client_match_queue IS
  'Ranked review queue: unactioned postings that pass the client''s hard rules, were seen in the last 14 days and are not closed (link check). Ranked in timing tiers (20261106, 20261107): a client whose available_from is in the future gets campus postings scoring 40 or more first, then "timing unknown"; a client available now gets postings starting now, within 3 months or not stated first, then "starts in 3+ months". Within a tier: best score first, unjudged last; at equal score a preferred-market posting first, then republished-only below others. likely_closed (link check) ranks below every tier. apply_url is the client''s market link when matching chose one (market_link). is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (both true):
-- SELECT
--   pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%IS NOT DISTINCT FROM ''likely_closed''%' AS likely_closed_never_null,
--   NOT EXISTS (SELECT 1 FROM public.client_match_queue WHERE likely_closed IS NULL) AS no_null_likely_closed;
