-- Resume Workshop, Phase 1. 2026-10-07.
--
-- IN PLAIN ENGLISH
--
-- A coach-only workspace for the live Resume Workshop conversation, replacing
-- the Google Doc of notes. It belongs to the coaching relationship
-- (coach_clients.id), like the plan, the SOW and the coach's notes, so it
-- works for a client with or without a SIGNAL login and stays with the coach
-- who ran it. The client never sees it in Phase 1.
--
--   resume_workshops          one per relationship: the workshop date, general
--                             notes, and resume text the coach pasted when none
--                             is on file. The client's resume on file
--                             (client_personas / client_profiles) is only ever
--                             READ, never written.
--   resume_workshop_entries   discovery entries, each on one of nine tabs, with
--                             a title and one large notes field. An entry made
--                             from the resume keeps that resume text in
--                             resume_excerpt, separate from the coach's notes.
--   resume_workshop_captures  Quick Capture notes: unassigned, or copied or
--                             moved into an entry. All of them are exported.
--   resume_workshop_history   every saved value of every field, so nothing
--                             typed in a live session can be lost to a bad save.
--
-- Stale saves: each editable field has its own version number. A save says
-- which version it was typed against and is refused if the field has moved on.
--
-- Access: service role only (RLS on, no policies), like the other coach
-- tables. Authorization is in the API: the caller must be the relationship's
-- coach or that coach's delegate, on an active relationship.
--
-- Additive: new tables only. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS resume_workshop_history, resume_workshop_captures,
--     resume_workshop_entries, resume_workshops;

CREATE TABLE IF NOT EXISTS resume_workshops (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id     UUID NOT NULL UNIQUE REFERENCES coach_clients(id) ON DELETE CASCADE,
  workshop_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  general_notes       TEXT NOT NULL DEFAULT '',
  general_version     INTEGER NOT NULL DEFAULT 0,
  pasted_resume_text  TEXT,
  created_by          UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resume_workshop_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id     UUID NOT NULL REFERENCES resume_workshops(id) ON DELETE CASCADE,
  tab             TEXT NOT NULL CHECK (tab IN (
                    'education', 'coursework', 'honors', 'certifications', 'experience',
                    'projects', 'skills', 'leadership', 'other')),
  title           TEXT NOT NULL DEFAULT '',
  title_version   INTEGER NOT NULL DEFAULT 0,
  notes           TEXT NOT NULL DEFAULT '',
  notes_version   INTEGER NOT NULL DEFAULT 0,
  -- 'resume' when the entry was made from the resume on file; its text is in
  -- resume_excerpt and is never edited. 'coach' for everything else.
  source          TEXT NOT NULL DEFAULT 'coach' CHECK (source IN ('coach', 'resume')),
  resume_excerpt  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resume_workshop_entries_workshop ON resume_workshop_entries (workshop_id, tab, sort_order);

CREATE TABLE IF NOT EXISTS resume_workshop_captures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id         UUID NOT NULL REFERENCES resume_workshops(id) ON DELETE CASCADE,
  body                TEXT NOT NULL DEFAULT '',
  body_version        INTEGER NOT NULL DEFAULT 0,
  copied_to_entry_id  UUID REFERENCES resume_workshop_entries(id) ON DELETE SET NULL,
  moved_to_entry_id   UUID REFERENCES resume_workshop_entries(id) ON DELETE SET NULL,
  moved_at            TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resume_workshop_captures_workshop ON resume_workshop_captures (workshop_id, created_at);

CREATE TABLE IF NOT EXISTS resume_workshop_history (
  id           BIGSERIAL PRIMARY KEY,
  workshop_id  UUID NOT NULL REFERENCES resume_workshops(id) ON DELETE CASCADE,
  -- workshop | entry | capture
  entity       TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  field        TEXT NOT NULL,
  value        TEXT,
  version      INTEGER NOT NULL,
  saved_by     UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  saved_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resume_workshop_history_entity ON resume_workshop_history (entity_id, field, version);

ALTER TABLE resume_workshops          ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_workshop_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_workshop_captures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_workshop_history   ENABLE ROW LEVEL SECURITY;
