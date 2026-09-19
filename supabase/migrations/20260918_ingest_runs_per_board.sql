-- 20260918_ingest_runs_per_board.sql
-- A run becomes "we asked THIS BOARD this question", and the counts reconcile
-- exactly. Follow-up to 20260918_ingest_schema.sql.
--
-- WHY. The first shape wrote one row per (pair, source) and pushed per-board
-- results into control_detail/detail as JSON. Two things were wrong with it:
--
--   * "which boards failed their control last week" needed a JSONB dig, which
--     is the question this table exists to answer.
--   * found_count minus added_count was unexplainable. A real run reported
--     found 109, added 77, and the missing 32 were two different things mixed
--     together: 22 postings already in the table, and 10 that appeared more
--     than once inside that same run. Two causes, one number, no way to tell
--     them apart afterwards.
--
-- SO: org_slug becomes a column, and the counts below make the arithmetic
-- closed.

ALTER TABLE public.ingest_runs
  -- The board this run asked. NULL is allowed because a source can be
  -- board-less: a single global endpoint answers for everyone. Distinguishing
  -- "this source has no boards" from "we forgot to record which board" is what
  -- the nullability costs, and it is worth it to avoid inventing a slug for
  -- sources that genuinely have none.
  ADD COLUMN IF NOT EXISTS org_slug text,

  -- Rows whose fingerprint was ALREADY in postings when this run reached them.
  -- The healthy steady state: a board re-offering what it offered yesterday.
  ADD COLUMN IF NOT EXISTS refound_count integer NOT NULL DEFAULT 0,

  -- Rows whose fingerprint had already been seen EARLIER IN THIS SAME RUN.
  -- Not an error and not a re-find: one board legitimately returns the same
  -- role twice under two requisition ids, and the fingerprint folds them. A
  -- number that climbs here is the board padding its own result count.
  ADD COLUMN IF NOT EXISTS intra_run_duplicate_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Clear rows that predate the new counts
-- ---------------------------------------------------------------------------
-- The reconciliation constraint below cannot be added while rows exist that
-- cannot satisfy it. Every row written before this migration has found_count
-- and added_count but no refound or duplicate counts, so the new columns take
-- their DEFAULT 0 and the identity fails by exactly the number of postings that
-- were re-found or internally duplicated. On dev that was three rows, short by
-- 4, 65 and 32 respectively.
--
-- WHY DELETE RATHER THAN BACKFILL. The obvious repair is
-- refound_count = found_count - added_count. That would be inventing data. The
-- gap is two different things added together -- postings already in the table,
-- and postings the board returned twice within one run -- and which is which
-- was never recorded. Splitting it now means guessing, and a guessed number in
-- a column whose whole purpose is to make the arithmetic honest is worse than
-- no row at all. The old rows cannot answer the question the new schema asks.
--
-- SCOPED TO ROWS THAT ACTUALLY BLOCK, not a blanket delete of the table:
--   * on a fresh database it removes nothing
--   * re-running this migration removes nothing
--   * a row that already reconciles is never touched, whatever wrote it
--
-- These rows are a log of ingest attempts, not ingested data. postings is
-- untouched: nothing that was ingested is lost, only the record of the runs
-- that could not describe themselves in the new terms.
DO $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.ingest_runs
  WHERE status = 'ok'
    AND found_count <> added_count + refound_count + intra_run_duplicate_count;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'ingest_runs: removed % pre-count row(s) that could not satisfy the reconciliation', removed;
END
$$;

-- The old bound stays. It is implied by the reconciliation below for ok rows
-- and still catches nonsense on the others.
ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS ingest_runs_counts_non_negative;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_counts_non_negative CHECK (
    requests_made >= 0
    AND found_count >= 0
    AND added_count >= 0
    AND refound_count >= 0
    AND intra_run_duplicate_count >= 0
  );

-- THE RECONCILIATION, and why it is conditional on status.
--
-- found_count means "postings the source handed back". A run that died partway
-- through has a found_count describing the whole response and classification
-- counts describing only the part it got through, so the identity cannot hold
-- and forcing it would mean either lying about found_count or refusing to log
-- the failure at all. An unlogged failure is the thing this table exists to
-- prevent, so the identity is asserted where it is true: on a run that finished.
--
-- 'skipped' rows satisfy it trivially, since every count is 0.
ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS ingest_runs_counts_reconcile;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_counts_reconcile CHECK (
    status <> 'ok'
    OR found_count = added_count + refound_count + intra_run_duplicate_count
  );

-- The health question is now per board, so it gets an index rather than a scan
-- plus a JSONB dig.
CREATE INDEX IF NOT EXISTS idx_ingest_runs_board_created
  ON public.ingest_runs (source, org_slug, created_at DESC);

COMMENT ON COLUMN public.ingest_runs.org_slug IS
  'The board this run asked, as it appears in the platform URL (AECOM2, CityOfNewYork, envista). NULL means the source has no per-board endpoint.';

COMMENT ON COLUMN public.ingest_runs.refound_count IS
  'Postings whose fingerprint was already in postings when this run reached them.';

COMMENT ON COLUMN public.ingest_runs.intra_run_duplicate_count IS
  'Postings whose fingerprint had already been seen earlier within this same run. One board returning the same role under two requisition ids.';

COMMENT ON TABLE public.ingest_runs IS
  'One row per (source, board, pair) ingest attempt, written whether it succeeded or not. On a status=ok row, found_count = added_count + refound_count + intra_run_duplicate_count exactly. control_passed records whether the server-side filter was proven to bite; FALSE or NULL means the counts describe an unfiltered board.';

NOTIFY pgrst, 'reload schema';
