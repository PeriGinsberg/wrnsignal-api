-- 20261105_ingest_pairs_campus_alex.sql
-- Campus versions of Alex Schwartz's 15 Google Jobs pairs
-- (20261025_ingest_pairs_seed_alex.sql): same 5 titles x 3 markets, campus =
-- true, so the query carries the recruiting class year (lib/ingest/serpapi.ts
-- campusYear: "financial analyst 2027 Chicago, IL" in October 2026).
--
-- Why: the coach's 2026-10-26 review pushed 4 of Alex's top 25, all campus
-- postings; the non-campus pairs surface few of them.
--
-- Applied on prod 2026-10-26 by script (same rows). Idempotent.

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, true, ARRAY['serpapi'],
       'Campus versions of Alex Schwartz pairs (2026-10-26)'
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
-- SELECT count(*) FROM public.ingest_pairs WHERE campus AND sources = ARRAY['serpapi'] AND notes LIKE 'Campus versions of Alex%';
