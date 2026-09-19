-- 20260918_ingest_runs_filtering.sql
-- Where the filtering happened, promoted from control_detail JSON to a column.
-- Follow-up to 20260918_ingest_runs_per_board.sql.
--
-- WHY THIS IS NOT COSMETIC. control_passed = true means two different things
-- and the column alone cannot say which:
--
--   filtering = 'server'  the pair's title and location were sent to the source
--                         as query parameters and the source narrowed the
--                         result. A passing control is evidence about the
--                         SOURCE: SmartRecruiters' `q` and `city` provably bit.
--
--   filtering = 'local'   the source has no keyword filter and returned its
--                         whole board; narrowing happened in our adapter. A
--                         passing control is evidence about OUR OWN CODE: the
--                         predicate narrowed and rejected a nonsense term. It
--                         says nothing about the source, which was never asked
--                         to filter. Greenhouse, Lever, Ashby and BambooHR are
--                         all this kind.
--
-- Reading control_passed across sources without this distinction silently
-- treats "the vendor's filter works" and "our filter works" as the same
-- assurance. They are not, and the second is much weaker: it cannot catch a
-- source that changed its response shape, only a predicate that stopped
-- narrowing.
--
-- "Which runs actually tested the source" is therefore a real query, and it
-- belongs in a column rather than behind control_detail->>'filtering'.

ALTER TABLE public.ingest_runs
  -- NULLABLE, because a run written before this column existed genuinely did
  -- not record it, and NOT NULL DEFAULT 'server' would assert something about
  -- those rows that nobody observed. The backfill below fills in only what was
  -- actually written down.
  ADD COLUMN IF NOT EXISTS filtering text;

ALTER TABLE public.ingest_runs
  DROP CONSTRAINT IF EXISTS ingest_runs_filtering_valid;
ALTER TABLE public.ingest_runs
  ADD CONSTRAINT ingest_runs_filtering_valid
    CHECK (filtering IS NULL OR filtering IN ('server', 'local'));

-- BACKFILL FROM WHAT WAS ALREADY RECORDED, not from the source name.
-- The runner has been stamping filtering into control_detail since the
-- Greenhouse adapter landed, so for those rows this is a move, not a guess.
-- Rows older than that have no such key and stay NULL, which is the honest
-- answer: we did not record it at the time.
--
-- Deriving it from `source` instead would be the tempting shortcut and it is
-- wrong: a source's filtering strategy is a property of the adapter version
-- that ran, not of the source name. An adapter that gains a server-side filter
-- later would make every historical row retroactively claim something false.
UPDATE public.ingest_runs
SET filtering = control_detail ->> 'filtering'
WHERE filtering IS NULL
  AND control_detail ? 'filtering'
  AND control_detail ->> 'filtering' IN ('server', 'local');

-- The health question worth asking across sources: which runs proved anything
-- about the SOURCE, as opposed to about our own predicate.
CREATE INDEX IF NOT EXISTS idx_ingest_runs_filtering
  ON public.ingest_runs (filtering, control_passed, created_at DESC);

COMMENT ON COLUMN public.ingest_runs.filtering IS
  'Where narrowing happened. server = the source filtered and control_passed is evidence about the source. local = the source returned its whole board and our adapter filtered, so control_passed is evidence about our predicate only. NULL = not recorded (predates the column).';

NOTIFY pgrst, 'reload schema';
