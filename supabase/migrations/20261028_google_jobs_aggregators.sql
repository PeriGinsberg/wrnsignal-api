-- 20261028_google_jobs_aggregators.sql
-- The no-overwrite rule covers both Google Jobs providers.
--
-- 20261027_posting_links.sql made a SerpApi re-find of a direct-source row
-- change nothing but last_seen_elsewhere_at. lib/ingest/searchapi.ts writes the
-- same Google Jobs results under source 'searchapi', so the rule now names both.
-- The list must match GOOGLE_JOBS_SOURCES in lib/ingest/googleJobs.ts, which is
-- also what the cross-source linker treats as never-primary.
--
-- Between the two providers there is no protection, on purpose: a 'searchapi'
-- re-find of a 'serpapi' row (or the reverse) is the same index re-finding the
-- same job, so it updates the row and advances last_seen_at like any re-find.
-- That is what lets GOOGLE_JOBS_PROVIDER be switched without stranding rows.
--
-- Requires 20261027_posting_links.sql. Apply BEFORE any SearchApi run on this
-- project: until it is applied, a 'searchapi' upsert onto a Greenhouse or
-- SmartRecruiters row would overwrite it. Idempotent.

CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  -- An aggregator re-finding a row a direct source owns: keep that row exactly
  -- as it was, and record the sighting separately.
  IF NEW.source IN ('serpapi', 'searchapi')
     AND OLD.source IS DISTINCT FROM 'serpapi'
     AND OLD.source IS DISTINCT FROM 'searchapi' THEN
    NEW := OLD;
    NEW.last_seen_elsewhere_at = now();
    -- updated_at still moves: the runner reads created_at <> updated_at as
    -- "this row already existed", which is what this was.
    NEW.updated_at = now();
    RETURN NEW;
  END IF;
  -- Pinned in the database rather than by every caller remembering to omit it.
  NEW.first_seen_at = OLD.first_seen_at;
  NEW.last_seen_at  = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: pins first_seen_at and advances last_seen_at. A serpapi or searchapi upsert onto a direct source''s row changes nothing but last_seen_elsewhere_at and updated_at.';

-- ---------------------------------------------------------------------------
-- Verify (both true)
-- ---------------------------------------------------------------------------
-- SELECT pg_get_functiondef('public.postings_touch_last_seen()'::regprocedure) LIKE '%''searchapi''%' AS names_searchapi,
--        EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.postings'::regclass AND tgname = 'postings_touch_last_seen' AND tgenabled = 'O') AS trigger_on;
