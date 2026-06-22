ALTER TABLE client_profiles
  ADD COLUMN client_seat_cap integer;

COMMENT ON COLUMN client_profiles.client_seat_cap IS
  'Max coach_clients rows this coach may own. NULL = unlimited. Enforced in /api/coach/create-client before account creation.';
