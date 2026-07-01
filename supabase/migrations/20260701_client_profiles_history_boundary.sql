-- Client-facing "clean slate" boundary for returning clients.
-- NULL = show all history (default for every existing + new user -> zero
-- behavior change). Set to now() at engagement start for a returning client
-- so their own Coaches Hub / job tracker / run history render only rows with
-- created_at >= this timestamp. Coach-side reads are NOT filtered by this.
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS history_boundary_at timestamptz NULL;

COMMENT ON COLUMN public.client_profiles.history_boundary_at IS
  'Returning-client clean slate. NULL = show all. When set, client-facing reads filter created_at >= this. Coach reads unaffected.';
