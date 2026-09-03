"use client"

import { getSupabaseBrowser } from "../../../lib/supabase-browser"

// Token resolution used across the network tracker pages: the live Supabase
// session, falling back to the handoff token set when a user arrives from Framer.
// Same pattern as the job tracker page.
export async function getToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowser().auth.getSession()
  if (data.session?.access_token) return data.session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

/**
 * The board this page is looking at, when it is not the viewer's own.
 *
 * A coach opens a client's networking board at
 * /dashboard/network?client_profile_id=<id>, and every route under
 * /api/network/ already accepts that same parameter as its subject. So the
 * param is read back off the page's own URL rather than being handed down
 * through props: there are ~20 call sites across the roster, the contact
 * record, the company panel and the composer, and a prop threaded through all
 * of them is a prop that will be forgotten at one of them. A forgotten prop
 * here does not fail loudly, it silently writes to the COACH'S OWN board, and
 * the coach would not find out until a contact they created for a client
 * turned up in their own roster.
 *
 * Returns null on the server and on the client's own board, which is the same
 * thing as far as every caller is concerned: no param, no subject, the route
 * falls back to the caller's own id exactly as before.
 */
export function subjectId(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("client_profile_id")
}

/** Carry the subject across an internal link, so a coach clicking from the
 *  roster into a contact record does not land back on their own board. */
export function withSubject(href: string): string {
  const id = subjectId()
  if (!id) return href
  // Idempotent on purpose. readBackTarget() replays a stored URL that already
  // carries the param, and a duplicate query key is then resolved by the
  // server, not here.
  if (href.includes("client_profile_id=")) return href
  const sep = href.includes("?") ? "&" : "?"
  return `${href}${sep}client_profile_id=${encodeURIComponent(id)}`
}

export async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()

  // DOUBLY SCOPED, and both halves are load-bearing.
  //
  // authFetch is not network-local: the tracker and profile trees import it too
  // (17 call sites at the time of writing). Appending a subject on the strength
  // of the URL alone would push client_profile_id into /api/tracker/* and
  // /api/profile from any page that happened to carry one, which is a different
  // feature that nothing here has tested. So the REQUEST must be a network API
  // call AND the PAGE must be a networking page. A coach's tracker view keeps
  // behaving exactly as it does today.
  const isNetworkApi = url.startsWith("/api/network/")
  const onNetworkPage =
    typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard/network")
  const subject = isNetworkApi && onNetworkPage ? subjectId() : null

  // Never twice: a caller that already spelled the param out keeps its own,
  // because a duplicated query key is resolved by the server, not by us.
  const finalUrl =
    subject && !url.includes("client_profile_id=") ? withSubject(url) : url

  return fetch(finalUrl, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}
