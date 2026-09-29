-- Every system task says where the work is done.
--
-- IN PLAIN ENGLISH
--
-- A task raised by SIGNAL is the product asserting there is something to do.
-- Until now it asserted that and then stopped, leaving the coach to work out
-- which of eleven screens it meant. Two of them cheated by writing a path into
-- the description text ("Watch them back: /dashboard/coach/practice/<id>"),
-- which is a link you cannot click.
--
-- So: a `link` column, required for system tasks and optional for hand-written
-- ones, rendered as a Go button.
--
-- WHY THE CHECK IS `NOT VALID`
--
-- Ten system tasks already exist in production, all of them done. They are
-- backfilled below and every one of them can be given a link, so the constraint
-- would in fact validate today. It is still declared NOT VALID, because the
-- alternative is a migration whose success depends on the backfill immediately
-- above it having matched every historical row -- including rows in databases
-- this file has not seen. NOT VALID enforces the rule on every insert and every
-- update from here on, which is the rule anyone actually wants, and cannot fail
-- on data that predates it.
--
-- Run `ALTER TABLE coach_tasks VALIDATE CONSTRAINT coach_tasks_system_has_link;`
-- by hand once the backfill has been confirmed everywhere, if the full
-- guarantee is wanted.
--
-- Reversibility:
--   ALTER TABLE coach_tasks DROP CONSTRAINT coach_tasks_system_has_link;
--   ALTER TABLE coach_tasks DROP COLUMN link;
--   ALTER TABLE coach_task_templates DROP COLUMN link_template;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

-- A PATH, NOT A URL. Same-origin only, enforced in lib/tasks/links.ts on write
-- and by the CHECK below on the way in. A Go button is pressed without reading;
-- an absolute URL behind one is a phishing primitive wearing SIGNAL's chrome,
-- and task titles already carry client-supplied names.
ALTER TABLE public.coach_tasks
  ADD COLUMN IF NOT EXISTS link TEXT;

-- The per-template pattern, e.g. '/dashboard/network?client_profile_id={clientId}'.
-- Tokens are resolved at task creation, so the chain stays rows rather than code.
ALTER TABLE public.coach_task_templates
  ADD COLUMN IF NOT EXISTS link_template TEXT;

-- ---------------------------------------------------------------------------
-- 2. The templates get their destinations
-- ---------------------------------------------------------------------------
-- Mirrors TEMPLATE_LINKS in lib/tasks/links.ts. Kept in both places on purpose:
-- the code is what a new task is built from, this is what existing rows carry,
-- and a migration that imported the constant would be a migration that changed
-- meaning the next time the constant did.

UPDATE public.coach_task_templates SET link_template =
  CASE key
    WHEN 'networking.create_campaign'  THEN '/dashboard/network?client_profile_id={clientId}'
    WHEN 'networking.define_campaign'  THEN '/dashboard/network?client_profile_id={clientId}'
    WHEN 'networking.review_campaign'  THEN '/dashboard/network?client_profile_id={clientId}'
    WHEN 'networking.upload_and_build' THEN '/dashboard/network/import?client_profile_id={clientId}'
    WHEN 'networking.share_plan'       THEN '/dashboard/network?client_profile_id={clientId}'
    ELSE link_template
  END
WHERE key IN (
  'networking.create_campaign', 'networking.define_campaign', 'networking.review_campaign',
  'networking.upload_and_build', 'networking.share_plan'
);

-- ---------------------------------------------------------------------------
-- 3. Backfill every existing system task
-- ---------------------------------------------------------------------------
-- OPEN AND DONE ALIKE. The ask was open tasks, and open tasks are the ones a
-- person will press. Done ones are included because `reopen_task` is a real
-- automation action: a done task with no link that came back to life would hit
-- the CHECK on UPDATE and take the rule down with it.

-- 3a. Chain tasks, from their template's pattern.
UPDATE public.coach_tasks t
   SET link = REPLACE(tpl.link_template, '{clientId}', t.client_profile_id::text)
  FROM public.coach_task_templates tpl
 WHERE t.template_id = tpl.id
   AND t.source = 'auto'
   AND t.link IS NULL
   AND tpl.link_template IS NOT NULL
   AND t.client_profile_id IS NOT NULL;

-- 3b. "Watch <name>'s practice round". The round id is in the description, as
-- a path, which is exactly the cheat this migration exists to remove. Pulled
-- out with a UUID match rather than by splitting on the prefix text, so a
-- reworded description does not silently stop matching.
UPDATE public.coach_tasks
   SET link = '/dashboard/coach/practice/' || (
         SELECT (regexp_matches(
           description,
           '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
         ))[1]
       )
 WHERE source = 'auto'
   AND link IS NULL
   AND title ILIKE 'Watch %practice round%'
   AND description ~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

-- 3c. "Build a practice round for <name>" lands on the client's Practice tab.
UPDATE public.coach_tasks
   SET link = '/dashboard/coach/clients/' || client_profile_id::text || '?tab=practice'
 WHERE source = 'auto'
   AND link IS NULL
   AND client_profile_id IS NOT NULL
   AND title ILIKE 'Build a practice round%';

-- 3d. "<name> finished the homework: <title>" lands on the Workbooks tab.
UPDATE public.coach_tasks
   SET link = '/dashboard/coach/clients/' || client_profile_id::text || '?tab=workbooks'
 WHERE source = 'auto'
   AND link IS NULL
   AND client_profile_id IS NOT NULL
   AND title ILIKE '%finished the homework%';

-- 3e. Everything else system-raised and client-scoped: the client record. Not
-- the exact screen, and deliberately last, so a row only lands here when no
-- specific rule above claimed it. Covers the "Invite <name>" reminder raised
-- when a prospect converts, whose work (Re-send invite) is on that header.
UPDATE public.coach_tasks
   SET link = '/dashboard/coach/clients/' || client_profile_id::text
 WHERE source = 'auto'
   AND link IS NULL
   AND client_profile_id IS NOT NULL;

-- 3f. The descriptions stop carrying the path.
--
-- Two task types wrote "Watch them back: /dashboard/..." into the sentence,
-- because there was nowhere else to put it. Now that there is, leaving the
-- text in place would show the same destination twice: once as a Go button
-- and once as a string nobody can click. Only touched where a link was
-- actually set, so a row that failed to backfill keeps its only clue.
-- Trimmed with a regex rather than TRIM(BOTH '...'), so the whitespace set is
-- spelled once, in the pattern, instead of as escape sequences inside a string
-- literal that every editor between here and the database gets a vote on.
UPDATE public.coach_tasks
   SET description = NULLIF(
         regexp_replace(
           regexp_replace(
             description,
             '\s*(Watch them back:|Review it in SIGNAL[^/]*)?\s*/dashboard/\S*',
             '',
             'g'
           ),
           '^\s+|\s+$', '', 'g'
         ), '')
 WHERE source = 'auto'
   AND link IS NOT NULL
   AND description LIKE '%/dashboard/%';

-- ---------------------------------------------------------------------------
-- 4. The rule, from here on
-- ---------------------------------------------------------------------------
-- A system task must carry a link. A manual one may. The path shape is checked
-- here too, so a bad link cannot reach the column even if a future caller
-- skips lib/tasks/links.ts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_tasks_system_has_link'
  ) THEN
    ALTER TABLE public.coach_tasks
      ADD CONSTRAINT coach_tasks_system_has_link
      CHECK (
        (source <> 'auto' OR link IS NOT NULL)
        AND (
          link IS NULL
          OR (link LIKE '/dashboard/%' AND link NOT LIKE '//%' AND link NOT LIKE '%\%')
        )
      )
      NOT VALID;
  END IF;
END $$;

-- The full list filters on it ("system tasks missing a destination" is a query
-- somebody will want after the next feature adds one), and it is cheap.
CREATE INDEX IF NOT EXISTS coach_tasks_system_no_link_idx
  ON public.coach_tasks (source)
  WHERE deleted_at IS NULL AND source = 'auto' AND link IS NULL;
