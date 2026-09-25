-- ═══════════════════════════════════════════════════
-- Generating a plan must not resurrect a finished share — 2026-09-26
-- ═══════════════════════════════════════════════════
--
-- IN PLAIN ENGLISH
--
-- A plan job is keyed on (coach_client_id, source_hash), and the index below
-- was UNIQUE across all rows. That is what makes a second Generate click
-- return the first job instead of starting a duplicate, which is right while a
-- job is in flight.
--
-- It is wrong once the job has been shared. Generating again returned the old
-- row complete with its shared_at, so the screen read "Shared with the client."
-- and hid the Share button, for a share the coach had not just performed. From
-- their side the plan appeared to share itself, and no email went out because
-- no share had actually run.
--
-- The guarantee we want is narrower than the one we had: AT MOST ONE UNSHARED
-- JOB per client and source. A job that has been shared is history; generating
-- again starts a fresh one that the coach can share on purpose.
--
-- Reversibility:
--   DROP INDEX IF EXISTS uq_networking_plan_jobs_source_unshared;
--   CREATE UNIQUE INDEX uq_networking_plan_jobs_source
--     ON public.networking_plan_jobs (coach_client_id, source_hash);
--
-- Reversible only while no client has two rows for one source hash. Once a
-- second generate has happened, restoring the full index requires deciding
-- which row to keep, so it is not a step to take casually.

-- The old guarantee, which covered shared rows too.
DROP INDEX IF EXISTS public.uq_networking_plan_jobs_source;

-- The narrower one. Two Generate clicks landing together still cannot make two
-- rows: both would be unshared, and the loser of this index re-reads, which is
-- the path findOrCreateJob already has for 23505.
CREATE UNIQUE INDEX IF NOT EXISTS uq_networking_plan_jobs_source_unshared
  ON public.networking_plan_jobs (coach_client_id, source_hash)
  WHERE shared_at IS NULL;

-- The listing query now has to find a client's previous share to inherit its
-- Drive file, so it looks up shared rows by source rather than scanning.
CREATE INDEX IF NOT EXISTS idx_networking_plan_jobs_shared_source
  ON public.networking_plan_jobs (coach_client_id, source_hash, shared_at DESC)
  WHERE shared_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
