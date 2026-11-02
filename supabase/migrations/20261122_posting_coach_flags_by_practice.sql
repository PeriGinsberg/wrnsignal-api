-- 20261122_posting_coach_flags_by_practice.sql
-- Job Queue: a coach's flag or saved link reaches only their own practice's clients.
--
-- A PRACTICE is a principal coach plus the principal's active delegates
-- (coach_delegates, 20260923). It is the only grouping of coaches SIGNAL has:
-- client_profiles.coach_org is a free-text label, read only for email copy.
-- Delegates act on the principal's clients (lib/collab/delegation.ts).
--
-- Until now posting_coach_flags held ONE row per posting, so a Closed / Not in
-- the US / Bad link flag or a "Save URL" link set by a coach in one practice
-- changed every client's queue, in every practice, and the saved link showed to
-- all of them. Now:
--   * one row per (posting, practice): practice_coach_id is the principal the
--     flagging coach belongs to (themselves when not a delegate);
--   * client_match_queue applies a flag to a client only when the flag's
--     practice is one of the client's coaches (an active coach_clients link), or
--     the principal of one of them.
-- Two practices sharing a client both reach that client: a closed / not_us
-- flag from either takes the job out; the newest saved link wins.
--
-- Same columns as before in client_match_queue, so CREATE OR REPLACE.
-- Requires 20261120_posting_coach_flags.sql. Same file for dev and prod. One transaction.

BEGIN;

ALTER TABLE public.posting_coach_flags
  ADD COLUMN IF NOT EXISTS practice_coach_id uuid REFERENCES public.client_profiles (id) ON DELETE CASCADE;

-- Existing rows: the practice of whoever set them.
UPDATE public.posting_coach_flags f
SET practice_coach_id = coalesce(
  (SELECT d.principal_coach_profile_id FROM public.coach_delegates d
   WHERE d.delegate_coach_profile_id = coalesce(f.flagged_by, f.url_saved_by) AND d.status = 'active'
   ORDER BY d.created_at LIMIT 1),
  coalesce(f.flagged_by, f.url_saved_by))
WHERE f.practice_coach_id IS NULL;
-- A row nobody can be traced to cannot be scoped: it no longer applies.
DELETE FROM public.posting_coach_flags WHERE practice_coach_id IS NULL;

ALTER TABLE public.posting_coach_flags ALTER COLUMN practice_coach_id SET NOT NULL;
ALTER TABLE public.posting_coach_flags DROP CONSTRAINT IF EXISTS posting_coach_flags_pkey;
ALTER TABLE public.posting_coach_flags ADD CONSTRAINT posting_coach_flags_pkey PRIMARY KEY (posting_id, practice_coach_id);

COMMENT ON TABLE public.posting_coach_flags IS
  'Job Queue flags on a posting, per practice (practice_coach_id = the principal coach; delegates flag for their principal). Applies only to clients of that practice: closed / not_us take the job out of their client_match_queue, bad_link ranks it last in its tier; apply_url is a coach-found link used ahead of every other.';

CREATE OR REPLACE VIEW public.client_match_queue
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
    -- This client's practices' flags on this posting, folded into one:
    -- closed, then not_us, then bad_link; the newest saved link.
    LEFT JOIN LATERAL (
      SELECT
        (array_agg(pf.flag ORDER BY CASE pf.flag WHEN 'closed' THEN 0 WHEN 'not_us' THEN 1 ELSE 2 END) FILTER (WHERE pf.flag IS NOT NULL))[1] AS flag,
        (array_agg(pf.apply_url ORDER BY pf.url_saved_at DESC) FILTER (WHERE pf.apply_url IS NOT NULL))[1] AS apply_url
      FROM public.posting_coach_flags pf
      WHERE pf.posting_id = m.posting_id
        AND pf.practice_coach_id IN (
          SELECT cc.coach_profile_id FROM public.coach_clients cc
          WHERE cc.client_profile_id = m.client_profile_id AND cc.status = 'active'
          UNION
          SELECT d.principal_coach_profile_id FROM public.coach_clients cc
          JOIN public.coach_delegates d ON d.delegate_coach_profile_id = cc.coach_profile_id AND d.status = 'active'
          WHERE cc.client_profile_id = m.client_profile_id AND cc.status = 'active')
    ) f ON true
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
  'Ranked review queue: undecided postings (no action, or evaluating: Add Job opened) that pass the client''s hard rules, were seen in the last 14 days, are not closed (link check) and not flagged closed or not in the US by a coach of this client''s practice (posting_coach_flags, per practice since 20261122). Ranked in timing tiers (20261106, 20261107): a client whose available_from is in the future gets campus postings scoring 40 or more first, then "timing unknown"; a client available now gets postings starting now, within 3 months or not stated first, then "starts in 3+ months". Within a tier: best score first, unjudged last; at equal score a preferred-market posting first, then republished-only below others. likely_closed (link check), then a coach bad_link flag with no saved link, rank below every tier. apply_url is the practice''s saved link, else the client''s market link (market_link), else the posting''s. is_new = first queued after the client''s last review.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (every row true):
-- SELECT 'practice column not null' AS check, (SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posting_coach_flags' AND column_name = 'practice_coach_id') AS ok
-- UNION ALL SELECT 'key is posting + practice', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'posting_coach_flags_pkey') = 'PRIMARY KEY (posting_id, practice_coach_id)'
-- UNION ALL SELECT 'view scopes by practice', pg_get_viewdef('public.client_match_queue'::regclass) LIKE '%practice_coach_id%'
-- UNION ALL SELECT 'view still has match_id', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_match_queue' AND column_name = 'match_id');
