-- Client Library Slice A — two tables.
--
-- coach_document_categories: practice-level master category list per coach.
--   Mirrors the coach_pipeline_stages family — coach-scoped, sort_order,
--   active soft-disable, set_updated_at trigger. No seed here: the default
--   starter list is seeded lazily on first GET (next commit), NOT in SQL.
--
-- coach_client_documents: per-client labeled links (pointers to external docs,
--   e.g. Google Drive URLs — not uploads). Mirrors the coach_client_notes
--   family — coach_client_id CASCADE, denormalized coach/client profile ids,
--   deleted_at soft-delete, partial index on active rows.
--
-- Delete-action design:
--   coach_client_id  → CASCADE  (documents die with the client relationship)
--   category_id      → SET NULL (links survive when a category is removed)
--   activity_id      → SET NULL (links survive when an engagement is detached;
--                                activity rows are CASCADE-deleted snapshots)

-- ── Practice catalog: master category list per coach ──
CREATE TABLE coach_document_categories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_profile_id UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_custom        BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coach_document_categories_coach_profile_id
  ON coach_document_categories (coach_profile_id);
CREATE TRIGGER trg_coach_document_categories_set_updated_at
  BEFORE UPDATE ON coach_document_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Per-client links ──
CREATE TABLE coach_client_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id   UUID NOT NULL REFERENCES coach_clients(id) ON DELETE CASCADE,
  coach_profile_id  UUID NOT NULL REFERENCES client_profiles(id),
  client_profile_id UUID NOT NULL REFERENCES client_profiles(id),
  category_id       UUID REFERENCES coach_document_categories(id) ON DELETE SET NULL,
  activity_id       UUID REFERENCES coach_client_engagement_activities(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);
CREATE INDEX idx_coach_client_documents_active
  ON coach_client_documents (coach_profile_id, client_profile_id, category_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE TRIGGER trg_coach_client_documents_set_updated_at
  BEFORE UPDATE ON coach_client_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
