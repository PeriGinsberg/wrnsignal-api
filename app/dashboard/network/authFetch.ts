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

export async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}
