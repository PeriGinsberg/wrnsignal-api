-- 20260920_ingest_runs_fetch_detail.sql
-- Two things a run row could not previously say.
--
-- 1. WHETHER WE GOT THE WHOLE BOARD.
-- found_count is what the adapter handed over. On a source that pages, that is
-- not the same as what the board holds, and the row gave no way to tell them
-- apart. The first 247-board Workday sweep returned exactly 20 postings on 124
-- of 243 boards -- the page limit, not a coincidence -- while Workday's own
-- response reported total: 304 for one of them. A truncated board and a fully
-- ingested one were indistinguishable in ingest_runs.
--
-- fetch_detail is the fetch-side twin of control_detail: adapter-supplied facts
-- about what the fetch saw. Deliberately jsonb and deliberately unconstrained,
-- because what "we got everything" means differs per source: Greenhouse returns
-- a whole board in one call and has nothing to report, Workday has total, pages
-- and a cap.
--
-- 2. WHAT THE REQUESTS ACTUALLY COST.
-- requests_made counts LOGICAL requests: one control, one per page. It does not
-- count retries, so a board that answered on the third attempt looked exactly
-- like one that answered immediately. Four boards in that same sweep failed on
-- transient Workday 500s and were lost for the whole pair; the adapters now
-- retry, and request_attempts is what makes the retry path measurable instead
-- of assumed. attempts - requests_made is the transient-failure cost.
--
-- Both nullable: rows written before this migration have neither, and a source
-- with nothing to report leaves fetch_detail NULL rather than writing an empty
-- object that would read as "reported nothing found".

ALTER TABLE public.ingest_runs
  ADD COLUMN IF NOT EXISTS fetch_detail jsonb,
  ADD COLUMN IF NOT EXISTS request_attempts integer;

ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_attempts_at_least_requests CHECK (
    request_attempts IS NULL OR request_attempts >= requests_made
  );

COMMENT ON COLUMN public.ingest_runs.fetch_detail IS
  'Adapter-supplied facts about the fetch, the fetch-side twin of control_detail. Workday records total, pages fetched, and whether the per-board page cap was hit, so a truncated board is distinguishable from a fully ingested one. NULL when the source has nothing to report.';

COMMENT ON COLUMN public.ingest_runs.request_attempts IS
  'HTTP calls actually issued, including retries. requests_made counts logical requests (one control, one per page); the difference is the transient-failure cost. NULL for rows written before retry existed.';

NOTIFY pgrst, 'reload schema';
