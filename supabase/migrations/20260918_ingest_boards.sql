-- 20260918_ingest_boards.sql
-- The configured boards, moved out of lib/ingest/boards.ts into a table.
--
-- WHY. Boards were a hardcoded constant while pairs had a table, which meant
-- adding one employer to the sweep was a deploy and pausing a board that had
-- started failing was a deploy plus a rollback. Pairs and boards change for
-- the same reason -- someone decides what to search -- and they should change
-- the same way.
--
-- WHY NOT A CHECK ON source. The set of sources grows whenever an adapter is
-- written, and a CHECK here would have to be edited in lockstep with code that
-- is not in this file. The runner resolves source -> adapter and will fail
-- loudly on a slug it does not recognise, which is the right place for that
-- error: it is a code fact, not a data fact.

CREATE TABLE IF NOT EXISTS public.ingest_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Matches ingest_runs.source and lane_results.source: grnhse, smartrecruiters.
  source text NOT NULL,

  -- The board identifier within that source, exactly as it appears in the
  -- platform's own apply URL. Case matters: SmartRecruiters answers
  -- "CityOfNewYork" and 404s on "cityofnewyork".
  org_slug text NOT NULL,

  -- Boards are paused, not deleted. A board that starts failing its control
  -- gets switched off; deleting the row would throw away the ingest_runs
  -- history's only explanation of why it stopped appearing.
  active boolean NOT NULL DEFAULT true,

  -- Where the slug came from, so a reader can tell a verified board from a
  -- guessed one. Every seed below came from a real apply_url in lane_results.
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingest_boards_source_not_blank CHECK (btrim(source) <> ''),
  CONSTRAINT ingest_boards_org_not_blank CHECK (btrim(org_slug) <> ''),

  -- One row per board per source. Case-sensitive on purpose: see org_slug.
  CONSTRAINT ingest_boards_unique UNIQUE (source, org_slug)
);

CREATE INDEX IF NOT EXISTS idx_ingest_boards_active
  ON public.ingest_boards (source, org_slug) WHERE active;

DROP TRIGGER IF EXISTS ingest_boards_set_updated_at ON public.ingest_boards;
CREATE TRIGGER ingest_boards_set_updated_at
  BEFORE UPDATE ON public.ingest_boards
  FOR EACH ROW EXECUTE FUNCTION public.ingest_set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the ten boards the sweep already runs
-- ---------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING so re-applying this migration is a no-op and so a
-- board someone has since paused is not silently switched back on.
INSERT INTO public.ingest_boards (source, org_slug, note) VALUES
  ('grnhse',          'capco',         'from lane_results apply_url'),
  ('grnhse',          'point72',       'from lane_results apply_url'),
  ('grnhse',          'janestreet',    'from lane_results apply_url'),
  ('grnhse',          'mediabrands',   'from lane_results apply_url (Omnicom Media)'),
  ('grnhse',          'scaleai',       'from lane_results apply_url'),
  ('smartrecruiters', 'AECOM2',        'from lane_results apply_url'),
  ('smartrecruiters', 'HMGroup',       'from lane_results apply_url'),
  ('smartrecruiters', 'CityOfNewYork', 'from lane_results apply_url'),
  ('smartrecruiters', 'RedBull',       'from lane_results apply_url'),
  ('smartrecruiters', 'Ramboll3',      'from lane_results apply_url')
ON CONFLICT (source, org_slug) DO NOTHING;

-- Same posture as the other ingest tables: global infrastructure with no
-- owning client, so RLS is enabled with no policy and only service-role
-- reaches it. Stated because an empty policy list reads like an oversight.
ALTER TABLE public.ingest_boards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ingest_boards IS
  'Boards the nightly sweep runs, one row per (source, org_slug). Paused with active=false rather than deleted, so ingest_runs history stays explainable.';

NOTIFY pgrst, 'reload schema';
