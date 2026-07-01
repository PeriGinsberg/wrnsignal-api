-- Return-customer flag for coach reporting. Set true when a coach marks a
-- prospect/client as a returning customer. Independent of the history
-- boundary (which lives on client_profiles and gates the client's own view).
ALTER TABLE public.coach_clients
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.coach_clients.is_returning IS
  'Coach-marked returning customer. Drives reporting; gates the history_boundary_at stamp at invite.';
