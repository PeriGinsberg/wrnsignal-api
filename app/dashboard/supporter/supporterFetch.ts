"use client"

import { getSupabaseBrowser } from "../../../lib/supabase-browser"

/** The live session's bearer, or null. Supporters never arrive by the Framer handoff. */
export async function supporterToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowser().auth.getSession()
  return data.session?.access_token ?? null
}

/** JSON in, JSON out, with the bearer. Never throws: a failure is { ok: false, error }. */
export async function supporterFetch(path: string, init: RequestInit = {}): Promise<any> {
  try {
    const token = await supporterToken()
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
    if (token) headers.Authorization = `Bearer ${token}`
    if (init.body) headers["Content-Type"] = "application/json"
    const res = await fetch(path, { ...init, headers })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) return { ok: false, status: res.status, error: j?.error || j?.message || "Something went wrong. Try again." }
    return j
  } catch {
    return { ok: false, error: "Network error. Try again." }
  }
}
