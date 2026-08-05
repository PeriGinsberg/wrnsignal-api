-- The monitor's heartbeat.
--
-- A row is written on EVERY run of the artifact-write monitor, healthy or not.
-- That is the whole point: without it, a monitor that has silently stopped is
-- indistinguishable from a monitor reporting all-clear, and a watcher you
-- cannot tell apart from a dead one is worse than none because it gives false
-- comfort.
--
-- With this table, liveness is a queryable fact rather than a hope:
--
--   SELECT max(ran_at) FROM monitor_runs;   -- older than ~25h? it is dead
--
-- The external dead-man's switch (Healthchecks.io) is the other half: it
-- alarms when it STOPS being pinged, which is the only design where the
-- monitor failing is itself alerted on, because the alarm lives outside the
-- system it watches. This table is what you check to confirm after the fact.

CREATE TABLE IF NOT EXISTS public.monitor_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor     text NOT NULL,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  -- "ok" or "alert". Recorded rather than derived so the history shows what
  -- the monitor CONCLUDED at the time, not what a later replay would conclude.
  status      text NOT NULL CHECK (status IN ('ok', 'alert')),
  -- The per-table counts the decision was made from, kept verbatim so an
  -- alert can be understood weeks later without re-running anything.
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_monitor_ran_at
  ON public.monitor_runs (monitor, ran_at DESC);

COMMENT ON TABLE public.monitor_runs IS
  'Heartbeat + verdict for scheduled monitors. A row per run, healthy or not, so a stopped monitor is detectable rather than silent.';

NOTIFY pgrst, 'reload schema';
