-- 20261025_ingest_pairs_seed_alex.sql
-- Alex Schwartz's 15 SerpApi pairs: the 5 titles x 3 markets of his active
-- lane "Financial Analyst — 3 markets" (search_lanes e1d6a23d-...), as run in
-- Phase 0. Not campus. Scoped to serpapi only.
--
-- Requires 20261025_ingest_serpapi_phase1.sql.
--
-- ON PROD, PASTE THIS ONLY AFTER the lib/ingest/nightly.ts change is promoted.
-- The code deployed today loads every active pair and ignores `sources`, so
-- these 15 rows would join tonight's Greenhouse and SmartRecruiters sweeps.
-- Dev has no crons, so on dev it is safe at once.
--
-- Pairs are global: nothing here references Alex, by design (see
-- ingest_pairs in 20260918_ingest_schema.sql). `notes` records where they came
-- from. Idempotent: re-running inserts nothing new.

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, false, ARRAY['serpapi'],
       'Phase 1 seed from Alex Schwartz lane e1d6a23d (2026-10-25)'
FROM (VALUES
  ('financial analyst'),
  ('investment banking analyst'),
  ('wealth management associate'),
  ('m&a analyst'),
  ('private wealth analyst')
) AS t(title)
CROSS JOIN (VALUES
  ('Chicago, IL'),
  ('Columbus, OH'),
  ('Indianapolis, IN')
) AS l(location)
ON CONFLICT DO NOTHING;

-- Verify: expect 15.
-- SELECT count(*) FROM public.ingest_pairs WHERE sources = ARRAY['serpapi'] AND notes LIKE 'Phase 1 seed from Alex%';
