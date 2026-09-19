-- 20260918_postings_touch_last_seen.sql
-- The database owns postings.last_seen_at and postings.first_seen_at, not the
-- caller. Follow-up to 20260918_ingest_schema.sql.
--
-- WHY THIS EXISTS. The obvious ingest upsert is "send last_seen_at, omit
-- first_seen_at so the existing value survives". That pattern CANNOT WORK
-- against this table, and the failure is not obvious from reading it:
--
--   INSERT ... ON CONFLICT (fingerprint) DO UPDATE
--
-- makes Postgres build the proposed tuple and run CHECK constraints on it
-- BEFORE the conflict is resolved. On a re-ingest the payload has no
-- first_seen_at, so the proposed tuple takes DEFAULT now() from the server
-- clock while last_seen_at carries a timestamp the application generated a
-- moment earlier. The proposed tuple therefore has last_seen_at < first_seen_at
-- and postings_seen_order rejects the whole statement:
--
--   ERROR 23514  new row for relation "postings"
--                violates check constraint "postings_seen_order"
--
-- even though the row was headed for the UPDATE branch where the stored
-- first_seen_at would have been kept and the ordering would have been fine.
-- Confirmed on dev: pushing last_seen_at into the future makes the identical
-- statement succeed, which is the tell that the UPDATE branch was never the
-- problem.
--
-- THE OTHER HALF OF THE TRAP. Sending neither timestamp passes the constraint
-- and then never advances last_seen_at at all, so "this posting is still on the
-- board" silently stops being recorded. That is exactly the blindness
-- lane_results had: a stale row and a missing row look identical, and nothing
-- tells you which you are looking at.
--
-- THE FIX. Ingest sends NEITHER timestamp. On insert both default to the same
-- now() and the check passes. On update this trigger advances last_seen_at from
-- the server clock and pins first_seen_at to what is already stored.
--
-- WHAT THIS DELIBERATELY COSTS: first_seen_at becomes unwritable through
-- UPDATE, by anyone, including a correction. That is the intent. "When did we
-- first see this posting" is an observation, and an observation that any caller
-- can quietly rewrite is not evidence of anything. Changing one is a deliberate
-- act: drop the trigger, correct the row, put it back.
--
-- It also removes application-server-to-database clock skew as a failure mode,
-- because only one clock is ever consulted.

CREATE OR REPLACE FUNCTION public.postings_touch_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  -- Pinned in the database rather than by every caller remembering to omit it.
  NEW.first_seen_at = OLD.first_seen_at;
  NEW.last_seen_at  = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Separate from postings_set_updated_at rather than folded into it: that
-- function is shared with ingest_pairs, which has no first_seen_at or
-- last_seen_at to touch. Both are BEFORE UPDATE and Postgres fires them in
-- trigger-name order (set_updated_at, then touch_last_seen); they write
-- different columns, so the order does not matter.
DROP TRIGGER IF EXISTS postings_touch_last_seen ON public.postings;
CREATE TRIGGER postings_touch_last_seen
  BEFORE UPDATE ON public.postings
  FOR EACH ROW EXECUTE FUNCTION public.postings_touch_last_seen();

COMMENT ON FUNCTION public.postings_touch_last_seen() IS
  'BEFORE UPDATE on postings: advances last_seen_at to now() and pins first_seen_at to its stored value. Ingest must send neither timestamp; sending last_seen_at on an upsert trips postings_seen_order during pre-conflict constraint evaluation.';

COMMENT ON COLUMN public.postings.first_seen_at IS
  'When ingest first saw this posting. Set once on insert and unwritable through UPDATE (see postings_touch_last_seen).';

COMMENT ON COLUMN public.postings.last_seen_at IS
  'When ingest last re-found this posting. Advanced by the database on every update; callers must not send it.';

NOTIFY pgrst, 'reload schema';
