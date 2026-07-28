-- 20260728_network_templates.sql
-- Phase 8a — per-client OVERRIDES of the 24 outreach templates.
--
-- THE DEFAULTS ARE NOT IN HERE, AND THAT IS THE DESIGN.
-- The 24 bodies live in lib/network-tracker/template-defaults.ts, transcribed
-- verbatim from the WRN v3 spreadsheet. This table holds a row ONLY when a
-- client or coach edits one. A client who never edits anything has zero rows,
-- and GET still returns 24 templates by merging code defaults with whatever
-- overrides exist.
--
-- Seeding 24 rows per client instead would mean: a migration to backfill every
-- existing client, a second one every time a default is reworded, and no way to
-- tell "the client chose this wording" from "this is just the default sitting
-- in a row". Deleting the override row IS the revert, which is why DELETE is
-- the whole revert mechanism rather than a copy-the-default-back operation.
--
-- BODIES ARE STORED LITERAL — [BRACKET] VARIABLES INCLUDED.
-- Nothing here or in the routes may normalise, escape, or validate bracket
-- contents. The templates use THREE kinds of variable, and the third breaks
-- naive validation:
--   1. profile   [TARGET_ROLE]      → resolves from network_client_profile
--   2. contact   [NAME] [FIRM]      → resolves from the contact record
--   3. fill-at-send                 → NEVER resolves; the writer completes it
--        [MUTUAL], [ONE SPECIFIC QUESTION], [OPTION 1], [OPTION 2], [OPTION 3],
--        [SPECIFIC THING THEY SAID], [ARTICLE / NEWS ABOUT THEIR FIRM], …
-- Kind 3 contains spaces and slashes. A validator that required UPPER_SNAKE
-- tokens, or that treated an unresolvable bracket as an error, would reject or
-- flag exactly the two templates a client uses most (S1 scheduling, C2 cold
-- follow-up). See docs/network-tracker/template-variables.md; the renderer that
-- acts on the distinction is 8b.
--
-- COACH-WRITABLE, ON PURPOSE.
-- PATCH/DELETE gate on assertBoardAccess(..., 'full'), not owner-only — the same
-- deliberate exception as network_client_profile. "Coaches cannot mutate"
-- protects the PIPELINE (stage, actions, reminders): the client's own record of
-- what they did. Templates are outbound copy a coach is expected to help write,
-- so both may edit and last save wins. edited_by records which of them it was.
-- (There is no 'edit' access level; the levels are view | annotate | full.)

CREATE TABLE IF NOT EXISTS public.network_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id uuid NOT NULL REFERENCES public.client_profiles(id) ON DELETE CASCADE,
  template_id       text NOT NULL,          -- 'C2', 'S1', … must match a default key
  body              text NOT NULL,          -- with [BRACKET] variables, stored literal
  edited_by         text NOT NULL CHECK (edited_by IN ('client','coach')),
  edited_by_id      uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One override per (client, template): the PATCH upserts onto this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_network_templates_client_template
  ON public.network_templates (client_profile_id, template_id);

CREATE INDEX IF NOT EXISTS idx_network_templates_owner
  ON public.network_templates (client_profile_id);

-- Reuses the trigger function the other network tables already install.
DROP TRIGGER IF EXISTS network_templates_set_updated_at ON public.network_templates;
CREATE TRIGGER network_templates_set_updated_at
  BEFORE UPDATE ON public.network_templates
  FOR EACH ROW EXECUTE FUNCTION public.network_set_updated_at();

-- RLS mirrors the other network tables: belt-and-braces, the API is the real guard.
ALTER TABLE public.network_templates ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
