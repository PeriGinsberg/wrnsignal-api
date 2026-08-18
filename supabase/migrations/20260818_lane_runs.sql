-- Lane run log: one row per lane per scheduled (or manual) run.
--
-- WHY THIS EXISTS. A lane that stops finding jobs and a lane that stops RUNNING
-- look identical from the review queue: both show nothing new. lane_results
-- records what was found and cannot express "the run failed", "the board
-- returned zero", or "we never got to this lane today" — and those three need
-- different responses.
--
-- Every run writes a row, success or failure, for the same reason the artifact
-- monitor does (20260805_monitor_runs.sql): a log written only on failure cannot
-- distinguish healthy from stopped.
--
-- The sweep-level heartbeat is NOT here. It goes to monitor_runs under
-- monitor='lane-sweep', because that table already answers "did the scheduled
-- thing run at all" and a second mechanism for the same question is how the two
-- come to disagree. This table answers the per-lane question only.
--
-- Probed on dev (zydrqckpwidipwbhrfgd) before writing:
--   search_lanes  EXISTS (3 rows, all active)
--   lane_results  EXISTS
--   lane_runs     ABSENT (PGRST205)
--   monitor_runs  EXISTS
-- Probe note worth repeating: a supabase-js `.select("*", {head:true,
-- count:"exact"})` against a non-existent table returns HTTP 204 with
-- error === null, which reads as "table exists, zero rows". Only a non-head
-- select surfaces the real PGRST205.

CREATE TABLE IF NOT EXISTS public.lane_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE CASCADE, not SET NULL: a run of a deleted lane is not a fact
  -- anyone can act on, and a pile of orphan rows would make the "which lanes
  -- ran today" query lie.
  lane_id    uuid NOT NULL REFERENCES public.search_lanes(id) ON DELETE CASCADE,

  -- 'ok'      the lane ran and its results were written
  -- 'error'   the lane was attempted and threw; `error` holds the message
  -- 'skipped' the sweep ran out of its time budget before reaching this lane.
  --           A distinct status because it is the one that means "the schedule
  --           is too small for the number of lanes", which is a capacity
  --           problem, not a fault.
  status     text NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),

  -- Who asked. 'cron' for the nightly sweep, 'manual' for the CLI, so a burst of
  -- runs during debugging cannot be mistaken for the schedule misfiring.
  trigger    text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),

  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),

  -- Counts, flattened because they are what you sort and total by.
  -- `jobs_added` is the number NEW to the lane; `jobs_found` is everything the
  -- run surfaced including re-finds. A lane can be perfectly healthy with
  -- jobs_added = 0 for days, so the two must not be collapsed.
  titles_run  integer,
  jobs_found  integer,
  jobs_added  integer,

  -- Per-title detail: [{title, query, fetched, available, capped, kept, dropped}]
  -- Kept as jsonb because a new field per title is a key, not a column, and
  -- nothing filters on it.
  detail      jsonb,

  error       text,

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "How is this lane doing lately" and "what ran last night" are the only two
-- questions asked of this table.
CREATE INDEX IF NOT EXISTS idx_lane_runs_lane_started
  ON public.lane_runs (lane_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lane_runs_started
  ON public.lane_runs (started_at DESC);

-- Partial index for the alerting question — failures are rare, so scanning
-- them should not cost a full scan of the healthy history.
CREATE INDEX IF NOT EXISTS idx_lane_runs_failures
  ON public.lane_runs (started_at DESC) WHERE status <> 'ok';

COMMENT ON TABLE public.lane_runs IS
  'One row per lane per run, success or failure. A lane that stopped running and a lane finding nothing look identical without this.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Same shape as search_lanes / lane_results: the API uses service-role and
-- filters explicitly, so this is belt-and-suspenders. Ownership is reached
-- through the lane, as lane_results does.
ALTER TABLE public.lane_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lane_runs_owner_all ON public.lane_runs;
CREATE POLICY lane_runs_owner_all ON public.lane_runs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.search_lanes l
    WHERE l.id = lane_runs.lane_id
      AND l.client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
