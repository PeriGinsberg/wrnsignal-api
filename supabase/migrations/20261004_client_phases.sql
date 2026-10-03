-- Client phases. 2026-10-04.
--
-- IN PLAIN ENGLISH
--
-- 1. coach_phases: each coach's phases, in order, each active or not. Every
--    existing coach is seeded with Know, Build, Prove, Search, Land; a coach
--    with none yet gets the same five the first time the app reads them.
--    Phases are never deleted, only switched off, so history keeps its labels.
-- 2. A dedicated phase on deliverables: on the coach's library deliverable
--    (coach_milestones) and on each client's copy of it
--    (coach_client_engagement_deliverables). Attaching a package now copies the
--    phase across. (category is untouched and still means what it did.)
-- 3. client_phase_status: one row per client per phase, holding Not started,
--    In progress or Complete, and who set it when. "Not in plan" is never
--    stored: the app works it out from the client's APPROVED packages, so
--    approving or removing a package changes it with nothing to keep in sync.
--
-- Additive: new tables, new nullable columns, the attach function redefined
-- with the same signature. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS client_phase_status;
--   ALTER TABLE coach_client_engagement_deliverables DROP COLUMN IF EXISTS phase_id;
--   ALTER TABLE coach_milestones DROP COLUMN IF EXISTS phase_id;
--   DROP TABLE IF EXISTS coach_phases;
--   (then restore attach_package_to_engagement from 20260605_coach_client_engagements.sql)

-- ── 1. Phases ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coach_phases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  -- Stable identity. Renaming changes the label, never the key.
  phase_key        TEXT NOT NULL,
  label            TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_profile_id, phase_key)
);

CREATE INDEX IF NOT EXISTS coach_phases_coach_idx ON coach_phases (coach_profile_id, sort_order);

INSERT INTO coach_phases (coach_profile_id, phase_key, label, sort_order)
SELECT p.id, d.phase_key, d.label, d.sort_order
FROM client_profiles p
CROSS JOIN (VALUES ('know', 'Know', 1), ('build', 'Build', 2), ('prove', 'Prove', 3),
                   ('search', 'Search', 4), ('land', 'Land', 5)) AS d(phase_key, label, sort_order)
WHERE p.is_coach = TRUE
ON CONFLICT (coach_profile_id, phase_key) DO NOTHING;

-- ── 2. A phase on deliverables ──────────────────────────────────────────────

ALTER TABLE coach_milestones
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES coach_phases(id) ON DELETE SET NULL;
ALTER TABLE coach_client_engagement_deliverables
  ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES coach_phases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS coach_client_engagement_deliverables_phase_idx
  ON coach_client_engagement_deliverables (phase_id) WHERE phase_id IS NOT NULL;

-- ── 3. Per-client phase status ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_phase_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id UUID NOT NULL REFERENCES coach_clients(id) ON DELETE CASCADE,
  phase_id        UUID NOT NULL REFERENCES coach_phases(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'complete')),
  -- Null when SIGNAL set it (a task starting moved the phase to In progress).
  updated_by      UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_client_id, phase_id)
);

-- ── 4. Attaching a package copies each deliverable's phase ─────────────────
-- Identical to 20260605_coach_client_engagements.sql except for phase_id.

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
    SELECT m.id AS milestone_id, m.name, m.fee_cents, m.category, m.time_estimate_days, m.phase_id,
           cpm.sort_order AS sort_order
      FROM coach_package_milestones cpm
      JOIN coach_milestones m ON m.id = cpm.milestone_id
     WHERE cpm.package_id = p_package_id
     ORDER BY cpm.sort_order, cpm.created_at
  LOOP
    INSERT INTO coach_client_engagement_deliverables
      (engagement_id, source_milestone_id, name, fee_cents, category, time_estimate_days, sort_order, phase_id)
    VALUES
      (v_engagement_id, v_deliv.milestone_id, v_deliv.name, v_deliv.fee_cents, v_deliv.category,
       v_deliv.time_estimate_days, v_deliv.sort_order, v_deliv.phase_id)
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

ALTER TABLE coach_phases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_phase_status ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
