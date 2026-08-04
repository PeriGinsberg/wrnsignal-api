"use client"

// Reopening a scored job in SIGNAL.
//
// The full JobFit analysis — the score breakdown, the WHY and RISK bullets, the
// evidence — is rendered by the Framer app at /signal/jobfit, not by Next.js.
// Next.js owns the tracker and stores the run; Framer owns the reading of it.
// So "see the analysis" is a cross-app jump, and the session has to travel with
// it or the student lands on a sign-in wall.
//
// That is why this is a function and not an href: the tokens are read at click
// time from the live session, never baked into the DOM. `location.replace`
// rather than `assign` so the tracker page does not sit in history behind a
// full app switch.
//
// Extracted so the Job Tracker's History list and the application detail page
// share one implementation. They were about to diverge.

import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { FRAMER_URL } from "../../../lib/urls"

export const JOBFIT_URL = `${FRAMER_URL}/signal/jobfit`

export async function openInSignal(runId: string): Promise<void> {
  const { data } = await getSupabaseBrowser().auth.getSession()
  const p = new URLSearchParams()
  if (data.session?.access_token) p.set("access_token", data.session.access_token)
  if (data.session?.refresh_token) p.set("refresh_token", data.session.refresh_token)
  // Tokens go in the FRAGMENT, not the query string: a fragment is not sent to
  // the server and does not land in access logs or a Referer header.
  window.location.replace(`${JOBFIT_URL}?run=${runId}#${p.toString()}`)
}
