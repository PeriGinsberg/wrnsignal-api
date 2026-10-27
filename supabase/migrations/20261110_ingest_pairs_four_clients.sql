-- 20261110_ingest_pairs_four_clients.sql
-- Google Jobs pairs for Anthony Negri, Catherine Lees, Cole Brigucci and
-- Lorenzo Vinueza, from the criteria Peri confirmed 2026-10-27.
--
--   Anthony    7 titles x New York + nationwide (NULL location), plain     14 pairs
--              (3 nationwide pairs already exist for Daniel Radner)
--   Catherine  10 titles x New York + Chicago, plain and campus           40 pairs
--              (marketing analyst in both cities already exists for Sami Zivitz / Daniel)
--   Cole       6 titles x Miami, plain (available now: no campus pairs)    6 pairs
--   Lorenzo    5 titles x Miami + nationwide, plain and campus            20 pairs
--              ("wealth management associate" nationwide plain already exists as an
--              ATS-only pair, sources NULL and active = false, so it is NOT searched
--              for Lorenzo: switching it on would also restart its ATS sweeps)
--
-- notes carry "client setup 2026-10-27" so the first run takes only these:
--   run-google-jobs.ts --notes "client setup 2026-10-27"
--
-- Applied on prod 2026-10-27 by script (same rows). Idempotent.

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, false, ARRAY['serpapi'], 'Anthony Negri, client setup 2026-10-27'
FROM (VALUES ('partnerships coordinator'), ('corporate partnerships coordinator'), ('partnership activation coordinator'),
             ('sponsorship coordinator'), ('partnership marketing coordinator'), ('brand partnerships coordinator'),
             ('partnerships associate')) AS t(title)
CROSS JOIN (VALUES ('New York, NY'), (NULL)) AS l(location)
ON CONFLICT DO NOTHING;

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, c.campus, ARRAY['serpapi'], 'Catherine Lees, client setup 2026-10-27'
FROM (VALUES ('marketing analyst'), ('digital marketing analyst'), ('marketing operations coordinator'),
             ('marketing automation specialist'), ('social media coordinator'), ('content marketing coordinator'),
             ('ai consultant'), ('ai strategy analyst'), ('sales development representative'),
             ('business development representative')) AS t(title)
CROSS JOIN (VALUES ('New York, NY'), ('Chicago, IL')) AS l(location)
CROSS JOIN (VALUES (false), (true)) AS c(campus)
ON CONFLICT DO NOTHING;

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, 'Miami, FL', false, ARRAY['serpapi'], 'Cole Brigucci, client setup 2026-10-27'
FROM (VALUES ('front desk agent'), ('guest service agent'), ('concierge'), ('manager in training'),
             ('food and beverage supervisor'), ('hotel sales coordinator')) AS t(title)
ON CONFLICT DO NOTHING;

INSERT INTO public.ingest_pairs (title, location, campus, sources, notes)
SELECT t.title, l.location, c.campus, ARRAY['serpapi'], 'Lorenzo Vinueza, client setup 2026-10-27'
FROM (VALUES ('wealth management analyst'), ('wealth management associate'), ('private wealth analyst'),
             ('private banking analyst'), ('portfolio analyst')) AS t(title)
CROSS JOIN (VALUES ('Miami, FL'), (NULL)) AS l(location)
CROSS JOIN (VALUES (false), (true)) AS c(campus)
ON CONFLICT DO NOTHING;
