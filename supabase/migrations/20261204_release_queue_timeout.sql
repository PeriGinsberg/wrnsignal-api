-- 20261204_release_queue_timeout.sql
-- release_queue() gets its own 60s statement timeout (Peri, 2026-11-15).
--
-- The nightly release runs through the API as service_role, which has no
-- timeout of its own and so takes the authenticator role's 8s. The release
-- took 5.4s by hand on an idle afternoon (2026-11-15) and timed out at 07:30
-- and 07:45 UTC, when the night's matching load is on the database. A
-- function-level statement_timeout applies to calls through the client
-- libraries (Supabase docs, "Timeouts"); 60s is the most an API call may have.
-- Nothing else that uses the API changes.
--
-- RUN AFTER 20261202: CREATE OR REPLACE FUNCTION drops a function's SET
-- clauses, so any later replacement of release_queue() must repeat this line.
-- Same file for dev and prod. Safe to run again.

BEGIN;

ALTER FUNCTION public.release_queue(integer, integer, integer, integer, timestamptz) SET statement_timeout = '60s';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verify (true):
-- SELECT 'statement_timeout=60s' = ANY (proconfig) AS has_timeout
-- FROM pg_proc WHERE oid = 'public.release_queue(integer, integer, integer, integer, timestamptz)'::regprocedure;
