-- 20261108_ingest_pairs_three_clients.sql
-- Google Jobs pairs for Sami Zivitz, Daniel Radner and Lindsey Keyes, from
-- the criteria Peri confirmed 2026-10-26.
--
--   Sami     9 titles x 5 markets, plain and campus           90 pairs
--   Daniel   7 titles x Chicago + nationwide (NULL location),
--            plain and campus                                  28 pairs
--   Lindsey  5 internship titles x New York + Miami, plain     10 pairs
--
-- South Florida is searched as "Miami, FL". A campus pair appends the
-- recruiting class year to the query (lib/ingest/serpapi.ts campusYear).
-- notes carry "client setup 2026-10-26" so the first run can take only these:
--   run-google-jobs.ts --notes "client setup 2026-10-26"
--
-- Applied on prod 2026-10-26 by script (same rows). Idempotent.

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, c.campus, ARRAY['serpapi'], 'Sami Zivitz, client setup 2026-10-26'
FROM (VALUES ('consulting analyst'), ('business analyst'), ('human capital analyst'), ('workforce analyst'),
             ('compensation analyst'), ('marketing analyst'), ('associate brand manager'),
             ('strategic communications associate'), ('public relations associate')) AS t(title)
CROSS JOIN (VALUES ('New York, NY'), ('Boston, MA'), ('Philadelphia, PA'), ('Washington, DC'), ('Miami, FL')) AS l(location)
CROSS JOIN (VALUES (false), (true)) AS c(campus)
ON CONFLICT DO NOTHING;

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, c.campus, ARRAY['serpapi'], 'Daniel Radner, client setup 2026-10-26'
FROM (VALUES ('partnership activation coordinator'), ('sponsorship coordinator'), ('event marketing coordinator'),
             ('experiential marketing coordinator'), ('partnerships associate'), ('marketing analyst'),
             ('business strategy analyst')) AS t(title)
CROSS JOIN (VALUES ('Chicago, IL'), (NULL)) AS l(location)
CROSS JOIN (VALUES (false), (true)) AS c(campus)
ON CONFLICT DO NOTHING;

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, false, ARRAY['serpapi'], 'Lindsey Keyes, client setup 2026-10-26'
FROM (VALUES ('marketing intern'), ('brand marketing intern'), ('communications intern'), ('strategy intern'),
             ('real estate intern')) AS t(title)
CROSS JOIN (VALUES ('New York, NY'), ('Miami, FL')) AS l(location)
ON CONFLICT DO NOTHING;

-- Verify: expect 90, 28, 10.
-- SELECT notes, count(*) FROM public.ingest_pairs WHERE notes LIKE '%client setup 2026-10-26' GROUP BY notes;
