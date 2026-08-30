// lib/supabase-browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let _client: SupabaseClient | null = null

/**
 * The localStorage key supabase-js will use for this project, derived rather
 * than hardcoded so dev and prod both work from their own NEXT_PUBLIC_SUPABASE_URL.
 *
 * This mirrors supabase-js's own default exactly:
 *   `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
 * which is how it builds the key when no explicit storageKey is passed, and we
 * pass none. Read out of the installed bundle rather than remembered, because
 * guessing this wrong means the heal below silently never fires.
 */
function authStorageKey(supabaseUrl: string): string | null {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
  } catch {
    return null
  }
}

/**
 * Delete a stored session whose refresh_token IS its access_token.
 *
 * WHERE THESE CAME FROM. The Framer handoff used to call
 *   setSession({ access_token: t, refresh_token: t })
 * with a single access token, because that was all the sender passed. setSession
 * makes no network call while the access token is still valid, so it succeeded
 * silently and persisted a session that could never be renewed. The first
 * auto-refresh then POSTed an access token to grant_type=refresh_token, got a
 * 400, and signed the user out of a tab they had not touched. The sender and
 * receiver are both fixed now, but every browser that went through the old path
 * is still carrying one of these, and it will fire once more on its own.
 *
 * WHY DELETE RATHER THAN REPAIR. There is nothing to repair with: the real
 * refresh token was never sent, so it does not exist on this origin. An empty
 * store means the app renders its normal signed-out state and the user signs in,
 * which is a decision they can understand. Leaving it means an unexplained
 * sign-out at some arbitrary point in the next hour.
 *
 * ONLY THIS EXACT SHAPE. Two identical tokens is not a state any legitimate
 * flow produces, so the check cannot false-positive on a healthy session.
 *
 * Best-effort throughout: storage can be unavailable (blocked cookies, private
 * mode) and the value can be malformed. Either way supabase-js is left to deal
 * with its own store, which is what happens today.
 */
function clearPoisonedSession(supabaseUrl: string): void {
  if (typeof window === "undefined") return
  const key = authStorageKey(supabaseUrl)
  if (!key) return

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return

    const parsed = JSON.parse(raw)
    // v2 stores the session at the top level. The `currentSession` nesting is
    // the v1 shape, checked as well because an old browser can still be holding
    // one and it costs one line.
    const session = parsed?.currentSession ?? parsed
    const access = session?.access_token
    const refresh = session?.refresh_token

    if (access && refresh && access === refresh) {
      window.localStorage.removeItem(key)
      // ERROR not warn, and greppable, matching AUTH_HANDOFF_* in the dashboard
      // layout. This should trend to zero; if it does not, a sender is still
      // handing off half a session somewhere.
      console.error(`AUTH_SESSION_POISONED_CLEARED key=${key}`)
    }
  } catch {
    // Unreadable or unparseable. Not ours to fix.
  }
}

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }

  // BEFORE createClient, DELIBERATELY. The auto-refresh timer belongs to the
  // GoTrueClient that createClient builds, so nothing can schedule a refresh
  // until the line below runs. This is the only place in the app a browser
  // Supabase client is constructed, and it is memoised, so running the heal
  // here covers every entry point exactly once.
  //
  // The dashboard layout would NOT have been early enough: openInSignal,
  // authFetch, signOutCompletely and roughly 28 pages all call
  // getSupabaseBrowser() themselves, and any of them can win the race to
  // construct the client depending on render order.
  clearPoisonedSession(url)

  _client = createClient(url, anonKey)
  return _client
}
