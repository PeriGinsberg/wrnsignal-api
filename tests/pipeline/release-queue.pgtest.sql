-- release_queue() against real Postgres, nights played forward
-- (run by tests/pipeline/release-queue-pg.sh after the stub and the migrations).
-- Time moves by shifting every stored date back one day ("next night"), since
-- the function reads now(). A failed night is a release that raises: its
-- transaction rolls back, as the nightly RPC's does.
SET client_min_messages = notice;
SET TIME ZONE 'UTC';

CREATE TEMP TABLE t_fail_count (n int); INSERT INTO t_fail_count VALUES (0);
CREATE TEMP TABLE t_nights (night date, released_at timestamptz);
CREATE FUNCTION pg_temp.ok(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(cond, false) THEN RAISE NOTICE 'ok    %', label;
  ELSE RAISE NOTICE 'FAIL  %', label; UPDATE t_fail_count SET n = n + 1; END IF;
END $$;

-- A match for a client, arrived d nights ago (06:00 UTC that night).
CREATE FUNCTION pg_temp.m(client uuid, score int, d int, deadline date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE pid uuid; mid uuid;
BEGIN
  INSERT INTO client_match_criteria (client_profile_id) VALUES (client) ON CONFLICT DO NOTHING;
  INSERT INTO postings (title, company, application_deadline) VALUES ('t', 'c', deadline) RETURNING id INTO pid;
  INSERT INTO posting_matches (client_profile_id, posting_id, score, first_queued_at)
    VALUES (client, pid, score, date_trunc('day', now()) + interval '6 hours' - make_interval(days => d)) RETURNING id INTO mid;
  RETURN mid;
END $$;

-- Tonight's release: floor 60, limit 1, 7 chances, deadline rule 50+.
CREATE FUNCTION pg_temp.run() RETURNS jsonb LANGUAGE sql AS $$ SELECT release_queue(60, 1, 7, 50, now() - interval '1 day') $$;
-- A release that fails after doing its work: everything it did rolls back.
CREATE FUNCTION pg_temp.fail() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN PERFORM pg_temp.run(); RAISE EXCEPTION 'statement timeout (simulated)';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;
-- Next night: every stored date one day earlier.
CREATE FUNCTION pg_temp.next_night() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE posting_matches SET first_queued_at = first_queued_at - interval '1 day', released_at = released_at - interval '1 day',
    released_night = released_night - 1, queue_expired_at = queue_expired_at - interval '1 day';

  DELETE FROM t_nights; INSERT INTO t_nights SELECT night - 1, released_at - interval '1 day' FROM queue_release_nights;
  DELETE FROM queue_release_nights; INSERT INTO queue_release_nights SELECT * FROM t_nights;
  UPDATE postings SET last_seen_at = now(), application_deadline = application_deadline - 1;
END $$;
CREATE FUNCTION pg_temp.state(id uuid) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN released_at IS NOT NULL THEN 'released' WHEN queue_expired_at IS NOT NULL THEN 'expired' ELSE 'waiting' END
  FROM posting_matches WHERE posting_matches.id = state.id $$;

DO $$
DECLARE
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); d uuid := gen_random_uuid();
  late uuid; pre uuid; unscored uuid; low uuid; urgent uuid; top uuid; c1 uuid; r jsonb; n int;
  night int;
BEGIN
  -- Night 0 is the first release night ever.
  pre := pg_temp.m(b, 70, 20);        -- queued 20 days before go-live, 60+, never released
  late := pg_temp.m(a, 65, 0);        -- arrives night 0, always outranked
  unscored := pg_temp.m(a, NULL, 0);
  low := pg_temp.m(a, 40, 0);
  urgent := pg_temp.m(d, 55, 0, (now() AT TIME ZONE 'UTC')::date + 3);
  top := pg_temp.m(d, 90, 0);
  c1 := pg_temp.m(c, 80, 0); PERFORM pg_temp.m(c, 80, 0); PERFORM pg_temp.m(c, 80, 0);

  -- Nights 0..8; nights 3 and 4 fail. A and B get a better match every night.
  FOR night IN 0..8 LOOP
    PERFORM pg_temp.m(a, 90, 0); PERFORM pg_temp.m(b, 90, 0);
    IF night IN (3, 4) THEN
      PERFORM pg_temp.fail();
    ELSE
      r := pg_temp.run();
      IF night = 0 THEN
        PERFORM pg_temp.ok('limit: one per client on night 0', (r->'released'->c::text->>'released')::int = 1);
        r := pg_temp.run();
        PERFORM pg_temp.ok('a second run the same night releases nothing more for a client at its limit', r->'released'->c::text IS NULL);
        PERFORM pg_temp.ok('deadline within 7 days at 50+: released first, under the floor', pg_temp.state(urgent) = 'released' AND pg_temp.state(top) = 'waiting');
        PERFORM pg_temp.ok('below the floor counted for the client', (r->'below_floor'->>a::text)::int = 1);
      END IF;
    END IF;
    IF night = 4 THEN
      SELECT count(*) INTO n FROM queue_release_nights;
      PERFORM pg_temp.ok('failed nights leave no release night: 3 recorded after nights 0-4', n = 3);
    END IF;
    IF night = 6 THEN
      PERFORM pg_temp.ok('night 6 (calendar 7th): a match with 5 real chances is still waiting', pg_temp.state(late) = 'waiting');
    END IF;
    IF night = 7 THEN
      PERFORM pg_temp.ok('night 7: 6 real chances, still waiting', pg_temp.state(late) = 'waiting');
      PERFORM pg_temp.ok('pre-go-live match counts from the first release night: still waiting on night 7', pg_temp.state(pre) = 'waiting');
    END IF;
    IF night = 8 THEN
      PERFORM pg_temp.ok('night 8: the 7th real chance used, expired', pg_temp.state(late) = 'expired');
      PERFORM pg_temp.ok('pre-go-live match expires on the same night as a night-0 arrival', pg_temp.state(pre) = 'expired');
      PERFORM pg_temp.ok('release result counts the expiry per client', (r->'expired'->>a::text)::int >= 1 AND (r->'expired'->>b::text)::int >= 1);
      PERFORM pg_temp.ok('unscored: never released or expired', pg_temp.state(unscored) = 'waiting');
      PERFORM pg_temp.ok('below the floor: never released or expired', pg_temp.state(low) = 'waiting');
      PERFORM pg_temp.ok('client C: one a night, all three released by night 2', (SELECT count(*) FROM posting_matches WHERE client_profile_id = c AND released_at IS NOT NULL) = 3);
      PERFORM pg_temp.ok('never more than the limit on any night for any client',
        NOT EXISTS (SELECT 1 FROM posting_matches WHERE released_night IS NOT NULL GROUP BY client_profile_id, released_night HAVING count(*) > 1));
    END IF;
    PERFORM pg_temp.next_night();
  END LOOP;

  -- Matches arriving on a failed night get their first chance at the next release.
  PERFORM pg_temp.ok('7 release nights recorded over 9 calendar nights', (SELECT count(*) FROM queue_release_nights) = 7);
END $$;

DO $$ BEGIN
  IF (SELECT n FROM t_fail_count) > 0 THEN RAISE EXCEPTION '% check(s) failed', (SELECT n FROM t_fail_count); END IF;
  RAISE NOTICE 'all passed';
END $$;
