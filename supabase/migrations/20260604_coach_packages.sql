-- Migration: Coach Packages — Phase 2 (data layer)
-- Creates coach_packages + coach_package_milestones join.
-- Conventions mirror coach_milestones / coach_pipeline_stages:
--   coach_profile_id FKs to client_profiles(id) ON DELETE CASCADE (no coach_profiles table),
--   public.set_updated_at() trigger (DD-07), sort_order for display, money in integer cents.
-- Apply: dev (zydrqckpwidipwbhrfgd) via Supabase SQL Editor — Foundation Risk 6 (dev tracker drift).
-- Prod: deferred to the deliberate promotion session (third gate, alongside Deliverables + job_type).

-- ── Packages ────────────────────────────────────────────────────────────────
CREATE TABLE coach_packages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  discount_cents   INTEGER,
  active           BOOLEAN NOT NULL DEFAULT true,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- null = no discount (distinct from $0); flat USD discount, stored as cents.
  CONSTRAINT coach_packages_discount_cents_nonneg
    CHECK (discount_cents IS NULL OR discount_cents >= 0)
);

CREATE INDEX idx_coach_packages_coach_profile_id
  ON coach_packages (coach_profile_id);

CREATE TRIGGER trg_coach_packages_set_updated_at
  BEFORE UPDATE ON coach_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Package ↔ Deliverable join (many-to-many) ────────────────────────────────
CREATE TABLE coach_package_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   UUID NOT NULL REFERENCES coach_packages(id)   ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES coach_milestones(id) ON DELETE RESTRICT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- a deliverable appears at most once per package
  CONSTRAINT coach_package_milestones_unique UNIQUE (package_id, milestone_id)
);

-- package delete cascades its join rows; milestone delete is RESTRICTed while referenced
-- (the milestones DELETE route checks membership first and returns 409 — see spec §1.3 / §4).
CREATE INDEX idx_coach_package_milestones_package_id
  ON coach_package_milestones (package_id);
CREATE INDEX idx_coach_package_milestones_milestone_id
  ON coach_package_milestones (milestone_id);
