-- Coached client Slice 1 — per-document visibility + the reverse-direction gate index.
--
-- Per-document client visibility. DEFAULT FALSE (private) — a deliberate divergence from
-- coach_annotations (which defaults true). A coach's Library is a curated workspace; nothing
-- reaches the client until explicitly shared. Existing rows (all coach-private today) correctly
-- become explicitly private via the default. Do NOT change this default to match annotations.
ALTER TABLE coach_client_documents
  ADD COLUMN visible_to_client BOOLEAN NOT NULL DEFAULT false;

-- Reverse-direction index for the coached-account gate. Every existing coach_clients index leads
-- with coach_profile_id; the gate queries by client_profile_id (the reverse), which table-scans
-- today. This lookup runs on every coached client's app load. Partial: prospects have null
-- client_profile_id and never match the gate.
CREATE INDEX idx_coach_clients_client_profile_id
  ON coach_clients (client_profile_id)
  WHERE client_profile_id IS NOT NULL;
