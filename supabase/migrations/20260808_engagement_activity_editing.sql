-- 20260808_engagement_activity_editing.sql
--
-- Coach-side editing of attached engagements. Two columns and one constraint.
--
-- Runs AFTER 20260808_proof_project.sql (which added is_proof_project and
-- speaking_point). Apply in filename order.
--
-- ── 1. is_signoff: the unlock trigger becomes a PROPERTY, not a POSITION ──
--
-- The Proof Project unlocked a deliverable when its "final coach-owned activity"
-- completed. That rule read the sign-off out of the ORDERING, which was fine
-- while the snapshot was immutable and is not fine now that coaches can reorder,
-- insert and delete activities: dragging a coach task to the end silently moved
-- which task released the client's reward, and nothing on screen said so.
--
-- is_signoff names it instead. Reordering can no longer change the unlock, which
-- is the whole point of this column.
--
-- ── 2. why_this_matters: the coach's framing, beside the client's line ──
--
-- speaking_point is what the CLIENT can say. why_this_matters is why it counts —
-- the coach's voice, shown under the reward once it is unlocked. Nullable, same
-- as speaking_point, and absent is a normal state rather than an empty section.

-- ── why_this_matters ──
ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN why_this_matters TEXT;

-- ── is_signoff ──
ALTER TABLE coach_client_engagement_activities
  ADD COLUMN is_signoff BOOLEAN NOT NULL DEFAULT false;

-- ── BACKFILL: reproduce the old rule exactly, so nothing changes on migrate ──
--
-- The old rule picked the LAST coach-owned activity per deliverable, ordered by
-- (sort_order, created_at). This marks precisely that row. Every deliverable
-- that was unlocked before this migration is still unlocked after it, and every
-- one that was locked is still locked.
--
-- Deliverables with NO coach-owned activity get NO signoff row, which is the
-- same population that fell through to the "all activities complete" fallback
-- before. That fallback is retained in code for exactly this case.
UPDATE coach_client_engagement_activities a
   SET is_signoff = true
  FROM (
    SELECT DISTINCT ON (engagement_deliverable_id) id
      FROM coach_client_engagement_activities
     WHERE owner = 'coach'
     ORDER BY engagement_deliverable_id, sort_order DESC, created_at DESC
  ) pick
 WHERE a.id = pick.id;

-- ── AT MOST ONE SIGN-OFF PER DELIVERABLE ──
--
-- Partial unique index: it constrains only the true rows, so the thousands of
-- false rows cost nothing and are unconstrained.
--
-- It enforces AT MOST one, not EXACTLY one — no index can require a row to
-- exist. Zero is therefore reachable (delete the sign-off, or a deliverable that
-- never had a coach task), and the code treats zero as "fall back to all
-- complete" rather than as "locked forever". The API is what refuses to leave a
-- deliverable at zero where it can avoid it; this index is what makes two
-- impossible.
--
-- Because it is a UNIQUE index, a coach moving the sign-off must clear the old
-- flag and set the new one in ONE statement or a defined order — a naive
-- "set new, then clear old" transiently violates it and will fail. The move
-- endpoint does both sides in a single transaction, old first.
CREATE UNIQUE INDEX uq_ccea_one_signoff_per_deliverable
  ON coach_client_engagement_activities (engagement_deliverable_id)
  WHERE is_signoff;

-- ── What this does NOT change ──
--
-- The catalog (coach_milestones / coach_milestone_activities) is untouched, and
-- attach_package_to_engagement is NOT updated to copy is_signoff: a newly
-- attached package has no sign-off marked and falls back until the coach sets
-- one. Marking sign-offs at the catalog level is a later decision — doing it
-- here would mean editing the RPC in the same migration that changes the read
-- rule, and those two want separate blast radii.
--
-- APPLICATION STATE:
--   DEV  (zydrqckpwidipwbhrfgd) — applied 2026-08-08. Backfill verified against
--   the old positional rule: 0 mismatches, max 1 sign-off per deliverable.
--   PROD (ejhnokcnahauvrcbcmic) — applied 2026-08-08 by hand, after
--   20260808_proof_project.sql. Same verification was run and recorded.
--
-- ORDER MATTERS: this runs SECOND. It assumes speaking_point already exists.
