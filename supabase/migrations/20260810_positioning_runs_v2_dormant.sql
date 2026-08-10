-- 20260810_positioning_runs_v2_dormant.sql
--
-- Positioning v2 was abandoned on 2026-08-10 and its code deleted. This
-- migration does not drop anything — it records, in the database itself, what
-- the surviving table is and is not.
--
-- WHY NOT DROP IT. Three live routes still read positioning_runs_v2:
--   app/api/coach/client-runs/[client_profile_id]/route.ts
--   app/api/feedback/positioning/route.ts
--   app/api/networking/route.ts
-- None breaks on an empty table; all three would break if it were dropped.
-- Removing it means editing three live routes for the sake of deleting an
-- empty table, which buys nothing. It stays, dormant.
--
-- THE NAMING IS THE TRAP. positioning_runs is the LIVE table (656 rows on prod
-- as of 2026-08-10, written by app/api/positioning/route.ts). positioning_runs_v2
-- is the ABANDONED one. The "_v2" suffix reads like the newer, better table.
-- It is the opposite. That is the whole reason this comment exists.

COMMENT ON TABLE public.positioning_runs_v2 IS
  'DORMANT — Positioning v2 (Stage 1c), abandoned 2026-08-10. Nothing writes '
  'this table; its writer was deleted. Retained deliberately because three live '
  'routes still read it (coach/client-runs, feedback/positioning, networking) '
  'and tolerate it being empty. DO NOT CONFUSE WITH positioning_runs, which is '
  'the live table that the current Positioning feature writes. See '
  'docs/positioning-v2-abandoned.md. Do not build on this table; if you need '
  'positioning storage, use positioning_runs.';

COMMENT ON TABLE public.positioning_runs IS
  'LIVE — written by app/api/positioning/route.ts. This is the real positioning '
  'storage, despite positioning_runs_v2 sounding newer. See '
  'docs/positioning-v2-abandoned.md.';

-- DEV:  applied 2026-08-10.
-- PROD: pending. Cosmetic only — comments carry no behaviour, so this can be
-- pasted into the SQL Editor whenever convenient. Nothing depends on it having
-- run, except the next person's understanding.
