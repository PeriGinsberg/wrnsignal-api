"use client"

// Signing out, properly, in one place.
//
// Extracted from the dashboard layout so the coach nav's "Log out" and the
// student's My Profile > Account run the SAME teardown. Two copies of this
// would drift, and the bug it fixes is the kind that hides for months because
// the redirect makes it look like it worked.
//
// THE BUG. A plain `signOut()` is a GLOBAL sign-out, which needs a round trip
// to the auth server to revoke the refresh token. When that call fails, and it
// does (an already-expired token answers 403, and the Framer handoff path
// stores an access token that was never a valid refresh token), supabase-js
// throws BEFORE clearing local storage. An empty catch around it swallowed the
// throw and redirected anyway, so the session survived the redirect and the
// user landed back in a signed-in dashboard. Found 2026-08-03; the coach nav
// had been carrying it since the beginning.
//
// So: attempt the global revoke, then ALWAYS follow with a local sign-out,
// which is pure local teardown and cannot fail on the network, and then sweep
// storage by hand as the guarantee.

import { getSupabaseBrowser } from "./supabase-browser"

export async function signOutCompletely(): Promise<void> {
  const supabase = getSupabaseBrowser()

  try {
    await supabase.auth.signOut()
  } catch {
    // Server-side revoke failed. The local teardown below is what actually
    // signs this browser out, so carry on.
  }
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch {
    // Belt and braces below covers even this.
  }

  if (typeof window === "undefined") return

  // The session lives in two places (no @supabase/ssr):
  //   1. Supabase's own key in localStorage, sb-<ref>-auth-token.
  //   2. signal_handoff_token in sessionStorage, the Framer-handoff bearer that
  //      getToken() falls back to across pages.
  // Both must go or the next load restores the session.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key)
    }
  } catch {
    // Storage unavailable, e.g. blocked cookies. Nothing else to do.
  }
  sessionStorage.removeItem("signal_handoff_token")
  sessionStorage.removeItem("signal_from_framer")
  // The job the dashboard offers to go back to. Same reason as the two above:
  // a second account signing in on this tab must not inherit the first one's
  // job, which would hand them a run id their token cannot read.
  sessionStorage.removeItem("signal_return_run")
  sessionStorage.removeItem("signal_return_title")

  // A full navigation, not router.push, so the app re-initialises from scratch
  // in the unauthenticated state.
  window.location.href = "/dashboard"
}
