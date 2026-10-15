-- Coach messages: the email log becomes the conversation log. 2026-10-18.
--
-- IN PLAIN ENGLISH
--
-- A coach can now write a client an email from SIGNAL (the Message button on
-- every client and prospect page). Those emails are saved in client_emails,
-- next to the ones SIGNAL sends on its own, so the Communications tab stays
-- the one history of everything a client was sent.
--
-- 1. client_emails gains what a conversation needs:
--      channel              'email' now; 'sms' later
--      direction            'outbound' now; 'inbound' when replies are captured
--      provider             who carried it: 'postmark' now; Outlook or Gmail later
--      provider_message_id  that provider's id for it. Copied from
--                           postmark_message_id for every existing row; the old
--                           column stays until nothing reads it.
--      status               'sent' when it leaves; Postmark's delivery and bounce
--                           webhook moves it to 'delivered', 'bounced' or
--                           'complained' (marked as spam)
--      status_detail        the bounce reason, as Postmark words it
--      status_at            when the status last changed
--      reply_to_email       where a reply goes (the coach's own address)
--      thread_id            empty until replies are captured; groups a message
--                           with its replies then
--
-- 2. coach_messaging_settings: one row per coach. The address their messages
--    come from (set by Peri in SQL; coaches cannot change it) and the plain-text
--    signature added to the end of every message (coaches edit that in
--    My Settings > Messaging).
--
-- 3. Peri and Erin's sending addresses, filled in from their coach profiles.
--
-- Additive: new columns with defaults and a new table. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS coach_messaging_settings;
--   DROP INDEX IF EXISTS client_emails_provider_message_id_key;
--   ALTER TABLE client_emails
--     DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS direction,
--     DROP COLUMN IF EXISTS provider, DROP COLUMN IF EXISTS provider_message_id,
--     DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS status_detail,
--     DROP COLUMN IF EXISTS status_at, DROP COLUMN IF EXISTS reply_to_email,
--     DROP COLUMN IF EXISTS thread_id;

-- ── 1. client_emails ──
ALTER TABLE client_emails
  ADD COLUMN IF NOT EXISTS channel             TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms')),
  ADD COLUMN IF NOT EXISTS direction           TEXT NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound', 'inbound')),
  ADD COLUMN IF NOT EXISTS provider            TEXT NOT NULL DEFAULT 'postmark',
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'delivered', 'bounced', 'complained', 'failed')),
  ADD COLUMN IF NOT EXISTS status_detail       TEXT,
  ADD COLUMN IF NOT EXISTS status_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_to_email      TEXT,
  ADD COLUMN IF NOT EXISTS thread_id           UUID;

UPDATE client_emails
   SET provider_message_id = postmark_message_id
 WHERE provider_message_id IS NULL AND postmark_message_id IS NOT NULL;

-- The webhook finds a message by its provider's id.
CREATE UNIQUE INDEX IF NOT EXISTS client_emails_provider_message_id_key
  ON client_emails (provider, provider_message_id);

-- ── 2. coach_messaging_settings ──
CREATE TABLE IF NOT EXISTS coach_messaging_settings (
  coach_profile_id UUID PRIMARY KEY REFERENCES client_profiles(id) ON DELETE CASCADE,
  -- Only addresses on the verified domain. The send checks this again.
  sending_email    TEXT CHECK (sending_email IS NULL OR lower(sending_email) LIKE '%@workforcereadynow.com'),
  signature        TEXT CHECK (signature IS NULL OR char_length(signature) <= 2000),
  provider         TEXT NOT NULL DEFAULT 'postmark' CHECK (provider IN ('postmark')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_coach_messaging_settings_set_updated_at ON coach_messaging_settings;
CREATE TRIGGER trg_coach_messaging_settings_set_updated_at
  BEFORE UPDATE ON coach_messaging_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE coach_messaging_settings ENABLE ROW LEVEL SECURITY;

-- ── 3. Peri and Erin ──
-- By the coach profile's own email, so no id is written down here. A profile
-- that is not there (a database without Erin) is skipped. The signature is
-- left alone on a re-run.
INSERT INTO coach_messaging_settings (coach_profile_id, sending_email)
SELECT p.id, s.sending_email
  FROM (VALUES
          ('peri@workforcereadynow.com', 'peri@workforcereadynow.com'),
          ('erin+coach@workforcereadynow.com', 'erin+coach@workforcereadynow.com')
       ) AS s(login_email, sending_email)
  JOIN client_profiles p ON lower(trim(p.email)) = s.login_email AND p.is_coach = true
ON CONFLICT (coach_profile_id) DO UPDATE SET sending_email = EXCLUDED.sending_email;

NOTIFY pgrst, 'reload schema';

-- Check:
--   SELECT p.email, s.sending_email FROM coach_messaging_settings s
--     JOIN client_profiles p ON p.id = s.coach_profile_id;
--   SELECT count(*) FILTER (WHERE provider_message_id IS NULL AND postmark_message_id IS NOT NULL)
--     FROM client_emails;   -- expect 0
