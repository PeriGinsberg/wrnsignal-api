-- The email log. 2026-10-17.
--
-- IN PLAIN ENGLISH
--
-- Every email SIGNAL sends to a client or prospect is saved here exactly as it
-- went out: who it was from and to, the CC and BCC, the subject, the full text
-- and HTML, what kind of email it was, who clicked to send it (NULL when SIGNAL
-- sent it on its own), and Postmark's message id. The Communications tab on a
-- client or prospect reads this table.
--
-- Private links (a SOW link, a sign-in link) are replaced before the row is
-- written, so the readable copy can never be used to open someone's SOW or
-- sign in as them. See lib/email/clientEmailLog.ts.
--
-- On a non-production deployment the mail is redirected to Peri; to_email is
-- still who it was meant for, delivered_to is where it actually went, and
-- redirected is true.
--
-- Additive: one new table. Safe to run twice.
--
-- Reversibility:
--   DROP TABLE IF EXISTS client_emails;

CREATE TABLE IF NOT EXISTS client_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_client_id     UUID REFERENCES coach_clients(id) ON DELETE CASCADE,
  email_type          TEXT NOT NULL,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_email          TEXT NOT NULL,
  to_email            TEXT NOT NULL,
  cc_email            TEXT,
  bcc_emails          TEXT[] NOT NULL DEFAULT '{}',
  delivered_to        TEXT NOT NULL,
  redirected          BOOLEAN NOT NULL DEFAULT false,
  subject             TEXT NOT NULL,
  text_body           TEXT,
  html_body           TEXT,
  triggered_by        UUID REFERENCES client_profiles(id) ON DELETE SET NULL,
  postmark_message_id TEXT,
  -- Loaded afterwards from Postmark's own record by
  -- tests/email/backfill-client-emails.ts, not saved at send time. Who sent
  -- it is a best guess from History and may be missing; nothing was BCC'd.
  backfilled          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_emails_coach_client_sent_idx
  ON client_emails (coach_client_id, sent_at DESC);

-- One row per Postmark message, so the backfill can be re-run.
CREATE UNIQUE INDEX IF NOT EXISTS client_emails_postmark_message_id_key
  ON client_emails (postmark_message_id);

-- Service role only, like every coach table: the API routes check access.
ALTER TABLE client_emails ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
