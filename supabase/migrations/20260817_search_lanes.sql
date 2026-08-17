-- Search lanes: a saved, repeatable job search, and the results it has found.
--
-- A "lane" is one standing search a client cares about ("Sports Coordinator,
-- NYC, entry level"). It holds several TITLES because a single job is
-- advertised under many names — "Coordinator, Partnership Service" and
-- "Sports Marketing Coordinator" are the same lane to a candidate and two
-- different queries to a job board. The runner fans one lane out into one
-- hiring.cafe query per title and folds the results back into one place.
--
-- Probed on dev (zydrqckpwidipwbhrfgd) before writing:
--   client_profiles EXISTS, id is uuid, 56 rows
--   search_lanes  ABSENT (PGRST205)
--   lane_results  ABSENT (PGRST205)
-- Probe note worth keeping: a supabase-js `.select("*", {head:true, count:"exact"})`
-- against a non-existent table returned HTTP 204 with error === null, which
-- reads as "table exists, zero rows". Only a non-head select surfaced the real
-- PGRST205. Probe with the thing you actually want to know about.

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
-- Own function rather than leaning on public.set_updated_at(). Other
-- migrations reference that one, but it is not verifiable from here and
-- network_tracker set the precedent of a feature-local trigger function.
CREATE OR REPLACE FUNCTION public.search_lanes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. search_lanes — the saved search
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.search_lanes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  name              text NOT NULL,
  -- Lanes are paused, not deleted. A lane carries its result history, so
  -- deleting one to stop it running would throw away the record of what it
  -- already found.
  active            boolean NOT NULL DEFAULT true,

  -- ["sports coordinator", "partnership coordinator", ...] — one query each.
  titles            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {"preset": "nyc", "radius_miles": 25} — `preset` keys the full Google
  -- Places payload in the fetcher's LOCATIONS table. Storing the preset key
  -- rather than a lat/lon pair is deliberate: hiring.cafe returns HTTP 200
  -- with zero results and an ssrError when handed a partial place object, so
  -- a location assembled from coordinates fails as a silent empty search.
  location          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Drop postings demanding more than this many years. NULL = no ceiling.
  -- Applied against the posting's stated minimum, and only when it states
  -- one — see lane_results.min_yoe.
  years_max         integer CHECK (years_max IS NULL OR years_max >= 0),
  -- Optional allowlist of employers. Empty array = no restriction (the
  -- common case), NOT "match nothing".
  companies         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {"companies": [...], "title_keywords": [...]} — drop rules applied after
  -- the fetch. Kept as one object so a new rule kind is a key, not a column.
  exclusions        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A lane's name is how the client refers to it, so it must be unambiguous
  -- within their own account and irrelevant across accounts.
  CONSTRAINT search_lanes_owner_name_unique UNIQUE (client_profile_id, name),

  -- The runner iterates titles and indexes into location/exclusions. Wrong
  -- json shapes would fail deep inside a run, mid-fetch, so reject at write.
  CONSTRAINT search_lanes_titles_is_array     CHECK (jsonb_typeof(titles) = 'array'),
  CONSTRAINT search_lanes_companies_is_array  CHECK (jsonb_typeof(companies) = 'array'),
  CONSTRAINT search_lanes_location_is_object  CHECK (jsonb_typeof(location) = 'object'),
  CONSTRAINT search_lanes_exclusions_is_object CHECK (jsonb_typeof(exclusions) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_search_lanes_owner_active
  ON public.search_lanes (client_profile_id, active);

DROP TRIGGER IF EXISTS search_lanes_set_updated_at ON public.search_lanes;
CREATE TRIGGER search_lanes_set_updated_at
  BEFORE UPDATE ON public.search_lanes
  FOR EACH ROW EXECUTE FUNCTION public.search_lanes_set_updated_at();

COMMENT ON TABLE public.search_lanes IS
  'A saved, repeatable job search for one client. Fans out to one job-board query per entry in titles.';

-- ---------------------------------------------------------------------------
-- 2. lane_results — what the lane has found
-- ---------------------------------------------------------------------------
-- Column-per-field rather than one result jsonb blob: these are filtered and
-- sorted on (seniority, salary, posted_at, min_yoe), and the lane's own
-- years_max is enforced against min_yoe. Fields that are natively lists or
-- objects at the source stay jsonb; flattening them would invent an ordering
-- the source never had.
CREATE TABLE IF NOT EXISTS public.lane_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lane_id      uuid NOT NULL REFERENCES public.search_lanes(id) ON DELETE CASCADE,

  -- hiring.cafe's own hit id, e.g. "smartrecruiters___nbcuniversal3___9d21...".
  -- Stable across refetches, which is what makes the dedup below work. text,
  -- not uuid: it is a composite source key, not a uuid.
  job_id       text NOT NULL,

  -- Which of the lane's titles surfaced this job. Diagnostic: a title that
  -- never appears here is dead weight in the lane.
  matched_title text,

  title             text,
  normalized_title  text,
  company           text,
  company_website   text,
  company_size      integer,
  company_industries jsonb NOT NULL DEFAULT '[]'::jsonb,
  apply_url         text,
  source            text,

  location          text,
  workplace_type    text,
  cities            jsonb NOT NULL DEFAULT '[]'::jsonb,
  states            jsonb NOT NULL DEFAULT '[]'::jsonb,
  geo               jsonb,

  seniority         text,
  role_type         text,
  commitment        jsonb NOT NULL DEFAULT '[]'::jsonb,
  category          text,

  -- NULL means the posting never stated a minimum, which is NOT the same as
  -- stating zero. The source flags these separately and the fetcher preserves
  -- the distinction; years_max filtering must not treat "unstated" as 0.
  min_yoe           integer,
  min_mgmt_yoe      integer,
  bachelors         text,
  bachelors_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
  tools             jsonb NOT NULL DEFAULT '[]'::jsonb,
  certifications    jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirements_summary text,

  salary_min        integer,
  salary_max        integer,
  salary_currency   text,
  salary_frequency  text,
  salary_transparent boolean,

  posted_at         timestamptz,
  visa_sponsorship  boolean,
  security_clearance text,
  is_expired        boolean,

  -- first_seen_at is never touched on re-run; last_seen_at advances every
  -- time the lane re-finds the job. The pair is what tells you a posting has
  -- fallen off the board (last_seen_at going stale) as opposed to never
  -- having been found — a single updated_at cannot express that.
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- The dedup. Scoped to the lane, not global: two lanes legitimately both
  -- want the same job, each with its own first_seen_at and matched_title.
  -- This is the runner's ON CONFLICT target.
  CONSTRAINT lane_results_lane_job_unique UNIQUE (lane_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_lane_results_lane_posted
  ON public.lane_results (lane_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_lane_results_lane_last_seen
  ON public.lane_results (lane_id, last_seen_at DESC);

DROP TRIGGER IF EXISTS lane_results_set_updated_at ON public.lane_results;
CREATE TRIGGER lane_results_set_updated_at
  BEFORE UPDATE ON public.lane_results
  FOR EACH ROW EXECUTE FUNCTION public.search_lanes_set_updated_at();

COMMENT ON TABLE public.lane_results IS
  'Jobs found by a search lane, deduped on (lane_id, job_id) where job_id is the hiring.cafe hit id. first_seen_at is set once; last_seen_at advances on every re-find.';

-- ---------------------------------------------------------------------------
-- 3. RLS (belt-and-suspenders; the API is the real guard)
-- ---------------------------------------------------------------------------
-- Same shape and same caveat as the network_* tables: routes use service-role
-- and filter explicitly. CREATE POLICY has no IF NOT EXISTS, hence drop-first.
ALTER TABLE public.search_lanes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS search_lanes_owner_all ON public.search_lanes;
CREATE POLICY search_lanes_owner_all ON public.search_lanes FOR ALL
  USING (client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid()));

-- lane_results has no client_profile_id of its own; ownership is reached
-- through the lane, matching how network_actions reaches it through contact.
ALTER TABLE public.lane_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lane_results_owner_all ON public.lane_results;
CREATE POLICY lane_results_owner_all ON public.lane_results FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.search_lanes l
    WHERE l.id = lane_results.lane_id
      AND l.client_profile_id = (SELECT id FROM client_profiles WHERE user_id = auth.uid())
  ));

NOTIFY pgrst, 'reload schema';
