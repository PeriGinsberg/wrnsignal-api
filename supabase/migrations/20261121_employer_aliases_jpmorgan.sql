-- 20261121_employer_aliases_jpmorgan.sql
-- JPMorgan Chase spellings -> one employer, so the Job Queue (lib/match/jobQueue.ts)
-- and linker v2 (lib/ingest/linkV2.ts) treat them as one company.
--
-- Spellings seen on the 2026-11-02 data: JPMorgan Chase & Co. (87), JPMorganChase
-- (81), JPMorgan Chase (30), JPMorgan Chase & Co (15), JP Morgan Chase (14),
-- JPMC Candidate Experience page (14), J.P. Morgan Chase & Co. (9), Chase (8),
-- J.P. Morgan (8), Testing Site - JPMC (4), Jpmorgan Chase Bank, N.A. (3),
-- Chase- Candidate Experience page (1). Morgan Stanley and Morgan & Morgan are
-- other employers and are not listed.
--
-- Data only. Matched on alias_norm (ingest_norm_text); a spelling already
-- mapped is left as it is. Same file for dev and prod.

INSERT INTO public.employer_aliases (alias, canonical, note) VALUES
  ('JPMorgan Chase & Co.',            'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('JPMorganChase',                   'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('JPMorgan Chase',                  'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('JP Morgan Chase',                 'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('JPMC Candidate Experience page',  'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings (Google Jobs site name)'),
  ('Chase- Candidate Experience page','JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings (Google Jobs site name)'),
  ('Chase',                           'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings (retail brand)'),
  ('J.P. Morgan',                     'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings (investment and private bank brand)'),
  ('Testing Site - JPMC',             'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('Jpmorgan Chase Bank, N.A.',       'JPMorgan Chase', 'Job Queue 2026-11-02: seen on postings'),
  ('JPMorgan Chase Bank',             'JPMorgan Chase', 'Job Queue 2026-11-02: likely spelling'),
  ('Chase Bank',                      'JPMorgan Chase', 'Job Queue 2026-11-02: likely spelling'),
  ('JPMorgan',                        'JPMorgan Chase', 'Job Queue 2026-11-02: likely spelling'),
  ('JPMC',                            'JPMorgan Chase', 'Job Queue 2026-11-02: likely spelling')
ON CONFLICT ON CONSTRAINT employer_aliases_alias_norm_unique DO NOTHING;

-- Verify (14 rows, all canonical JPMorgan Chase):
-- SELECT alias, alias_norm, canonical FROM public.employer_aliases WHERE canonical = 'JPMorgan Chase' ORDER BY alias;
