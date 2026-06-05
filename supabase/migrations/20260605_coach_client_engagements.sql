-- 20260605_coach_client_engagements.sql
--
-- Client Engagement slice 1 — schema + attach RPC.
--
-- Three tables hold a FROZEN snapshot of a coach's package at the moment it is
-- attached to a coach<->client relationship (coach_clients row). The snapshot is
-- independent of the live catalog: the source_*_id columns are provenance-only
-- back-pointers with ON DELETE SET NULL, so deleting a catalog package /
-- deliverable / activity NEVER mutates a frozen engagement — only the
-- back-pointer nulls out.
--
--   coach_client_engagements              (package snapshot: name + discount_cents)
--     └─ coach_client_engagement_deliverables   (deliverable snapshots)
--          └─ coach_client_engagement_activities (activity snapshots)
--
-- Money is integer cents throughout (dollars live only at the API edge).
-- updated_at is maintained by the shared public.set_updated_at() trigger fn.
--
-- RPC: public.attach_package_to_engagement(p_coach_client_id, p_package_id,
--      p_coach_profile_id) RETURNS uuid. Snapshots a package + its deliverables
--      + their activities into a new engagement, all-or-nothing.
--
-- Authorization (mirrors intake_upsert_with_targeting):
--   - SECURITY INVOKER (runs with the caller's privileges).
--   - EXECUTE REVOKEd from PUBLIC/anon/authenticated and GRANTed to service_role
--     only, so an end user with a JWT can't bypass the route by calling /rpc
--     directly. The service-role caller resolves identity (the coach's
--     client_profiles id) before calling; the function enforces ownership.
--
-- attach_package_to_engagement — payload / return / errors:
--   Params:
--     p_coach_client_id   uuid — coach_clients.id the engagement attaches to.
--     p_package_id        uuid — coach_packages.id to snapshot.
--     p_coach_profile_id  uuid — the authed coach's client_profiles.id; BOTH the
--                                coach_clients row and the package must belong to it.
--   Returns: uuid — the new coach_client_engagements.id.
--   Errors (RAISE → rollback → PostgREST surfaces error.message):
--     - 'coach_client_not_found_or_wrong_coach' — no coach_clients row matches
--       (id, coach_profile_id).
--     - 'package_not_found_or_wrong_coach'      — no coach_packages row matches
--       (id, coach_profile_id).
--   The whole body is one implicit transaction: any RAISE rolls back every insert.
--
-- DEV ENV ONLY. Applied to DEV (zydrqckpwidipwbhrfgd) via direct Postgres. Do
-- NOT promote to prod (joins the closed-gate pile).

-- ── Table 1: engagement (package snapshot) ──
CREATE TABLE coach_client_engagements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id   uuid NOT NULL REFERENCES coach_clients(id) ON DELETE CASCADE,
  source_package_id uuid REFERENCES coach_packages(id) ON DELETE SET NULL,  -- provenance only
  name              TEXT NOT NULL,
  discount_cents    INTEGER,
  attached_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_client_engagements_discount_cents_nonneg
    CHECK (discount_cents IS NULL OR discount_cents >= 0)
);
CREATE INDEX idx_cce_coach_client_id ON coach_client_engagements (coach_client_id);
CREATE TRIGGER trg_cce_set_updated_at
  BEFORE UPDATE ON coach_client_engagements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Table 2: deliverable snapshots ──
CREATE TABLE coach_client_engagement_deliverables (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id       uuid NOT NULL REFERENCES coach_client_engagements(id) ON DELETE CASCADE,
  source_milestone_id uuid REFERENCES coach_milestones(id) ON DELETE SET NULL,  -- provenance only
  name                TEXT NOT NULL,
  fee_cents           INTEGER,
  category            TEXT,
  time_estimate_days  NUMERIC,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cced_fee_cents_nonneg CHECK (fee_cents IS NULL OR fee_cents >= 0)
);
CREATE INDEX idx_cced_engagement_id ON coach_client_engagement_deliverables (engagement_id);
CREATE TRIGGER trg_cced_set_updated_at
  BEFORE UPDATE ON coach_client_engagement_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Table 3: activity snapshots ──
CREATE TABLE coach_client_engagement_activities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_deliverable_id uuid NOT NULL REFERENCES coach_client_engagement_deliverables(id) ON DELETE CASCADE,
  source_activity_id        uuid REFERENCES coach_milestone_activities(id) ON DELETE SET NULL,  -- provenance only
  name                      TEXT NOT NULL,
  owner                     TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'not_started',
  sort_order                INTEGER NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ccea_owner_valid  CHECK (owner  IN ('coach', 'client', 'both')),
  CONSTRAINT ccea_status_valid CHECK (status IN ('not_started', 'in_progress', 'complete'))
);
CREATE INDEX idx_ccea_engagement_deliverable_id ON coach_client_engagement_activities (engagement_deliverable_id);
CREATE TRIGGER trg_ccea_set_updated_at
  BEFORE UPDATE ON coach_client_engagement_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RPC: attach a package as a frozen engagement snapshot ──
CREATE OR REPLACE FUNCTION public.attach_package_to_engagement(
  p_coach_client_id  uuid,
  p_package_id       uuid,
  p_coach_profile_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pkg_name      TEXT;
  v_pkg_discount  INTEGER;
  v_engagement_id uuid;
  v_deliv         RECORD;
  v_new_deliv_id  uuid;
  v_act           RECORD;
BEGIN
  -- 1. Ownership gates — both the relationship AND the package must belong to
  --    the authed coach. Either miss rolls back (nothing has been written yet).
  IF NOT EXISTS (
    SELECT 1 FROM coach_clients
    WHERE id = p_coach_client_id AND coach_profile_id = p_coach_profile_id
  ) THEN
    RAISE EXCEPTION 'coach_client_not_found_or_wrong_coach';
  END IF;

  SELECT name, discount_cents
    INTO v_pkg_name, v_pkg_discount
    FROM coach_packages
   WHERE id = p_package_id AND coach_profile_id = p_coach_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found_or_wrong_coach';
  END IF;

  -- 2. Engagement snapshot (package name + discount frozen).
  INSERT INTO coach_client_engagements (coach_client_id, source_package_id, name, discount_cents)
  VALUES (p_coach_client_id, p_package_id, v_pkg_name, v_pkg_discount)
  RETURNING id INTO v_engagement_id;

  -- 3. Deliverable snapshots, in the package's link order.
  FOR v_deliv IN
    SELECT m.id AS milestone_id, m.name, m.fee_cents, m.category, m.time_estimate_days,
           cpm.sort_order AS sort_order
      FROM coach_package_milestones cpm
      JOIN coach_milestones m ON m.id = cpm.milestone_id
     WHERE cpm.package_id = p_package_id
     ORDER BY cpm.sort_order, cpm.created_at
  LOOP
    INSERT INTO coach_client_engagement_deliverables
      (engagement_id, source_milestone_id, name, fee_cents, category, time_estimate_days, sort_order)
    VALUES
      (v_engagement_id, v_deliv.milestone_id, v_deliv.name, v_deliv.fee_cents, v_deliv.category,
       v_deliv.time_estimate_days, v_deliv.sort_order)
    RETURNING id INTO v_new_deliv_id;

    -- 4. Activity snapshots for this deliverable, in order. status defaults
    --    to 'not_started' (a fresh engagement starts untouched).
    FOR v_act IN
      SELECT a.id AS activity_id, a.name, a.owner, a.sort_order
        FROM coach_milestone_activities a
       WHERE a.milestone_id = v_deliv.milestone_id
       ORDER BY a.sort_order, a.created_at
    LOOP
      INSERT INTO coach_client_engagement_activities
        (engagement_deliverable_id, source_activity_id, name, owner, sort_order)
      VALUES
        (v_new_deliv_id, v_act.activity_id, v_act.name, v_act.owner, v_act.sort_order);
    END LOOP;
  END LOOP;

  -- 5. Return the new engagement id. The transaction commits on normal return.
  RETURN v_engagement_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.attach_package_to_engagement(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.attach_package_to_engagement(uuid, uuid, uuid)
  TO service_role;
