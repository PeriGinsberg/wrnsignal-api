-- Each automation event is run once.
--
-- IN PLAIN ENGLISH
--
-- The queue in coach_automation_events is worked from two places: inline,
-- right after a coach ticks a task, and by the half-hourly cron. Neither took
-- a lock. Two of them reading the queue at the same moment would both see the
-- same unprocessed event and both apply its rules, so the chain could create
-- its next task twice and email the assignee twice.
--
-- Now a runner claims an event before working it. The claim is one UPDATE
-- that only succeeds while the event is unprocessed and unclaimed, so when two
-- runners race, Postgres lets exactly one of them have the row and the other
-- moves on. No function, no advisory lock: a row lock on a conditional UPDATE
-- is the whole mechanism.
--
-- A CLAIM EXPIRES AFTER TEN MINUTES. A runner that dies mid-event (a function
-- timeout, a deploy) would otherwise leave the event claimed and never
-- processed. Ten minutes is far longer than any event takes and far shorter
-- than the half-hour cron, so the next cron run picks it up. The window lives
-- in lib/automation/run.ts (CLAIM_TTL_MS).
--
-- Safe on any database: one nullable column and one index, no data changed.
-- Code that claims will fail until this column exists, so apply it BEFORE the
-- deploy that ships the claiming runner.
--
-- Reversibility:
--   DROP INDEX IF EXISTS coach_automation_events_unprocessed_idx;
--   ALTER TABLE coach_automation_events DROP COLUMN claimed_at;

ALTER TABLE coach_automation_events
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN coach_automation_events.claimed_at IS
  'Set by the runner that is working this event. Null, or older than the claim window, means it is free to take.';

-- The runner's read is "unprocessed, oldest first". Partial, because processed
-- rows are nearly all of the table and never read by the runner again.
CREATE INDEX IF NOT EXISTS coach_automation_events_unprocessed_idx
  ON coach_automation_events (occurred_at)
  WHERE processed_at IS NULL;
