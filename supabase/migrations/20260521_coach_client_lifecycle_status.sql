-- ═══════════════════════════════════════════════════
-- SIGNAL Coach Center — Client lifecycle status (2026-05-21)
-- ═══════════════════════════════════════════════════
--
-- Adds a coach-driven CRM lifecycle status to coach_clients, distinct from
-- the existing `status` column which is system-owned (drives the invite
-- flow: pending → active → paused → revoked).
--
-- `lifecycle_status` is coach-managed and reflects the coach's view of the
-- working relationship:
--   - Prospect   — early-stage / not yet engaged
--   - Active     — currently coaching (default for existing rows)
--   - Inactive   — paused but retained on the roster
--   - Archived   — closed out, kept for reference
--
-- Default 'Active' so existing rows land in the right bucket without
-- manual cleanup post-migration.
--
-- An index on (coach_profile_id, lifecycle_status) supports future
-- filtered list views (e.g. "show only Active clients").
--
-- User-facing surfaces refer to this column as "Status" only. The word
-- "lifecycle" is internal-only.
--
-- Reversibility:
--   DROP INDEX IF EXISTS idx_coach_clients_lifecycle_status;
--   ALTER TABLE coach_clients DROP COLUMN lifecycle_status;

ALTER TABLE coach_clients
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'Active'
  CHECK (lifecycle_status IN ('Prospect','Active','Inactive','Archived'));

CREATE INDEX idx_coach_clients_lifecycle_status
  ON coach_clients(coach_profile_id, lifecycle_status);
