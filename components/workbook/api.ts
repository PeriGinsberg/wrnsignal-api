"use client"

// components/workbook/api.ts
// Bearer-authenticated fetch for the workbook pages. Same token source as the
// Coaches Hub: the Supabase session, or the Framer handoff token.

import { getSupabaseBrowser } from "../../lib/supabase-browser"

export async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return typeof sessionStorage !== "undefined" ? sessionStorage.getItem("signal_handoff_token") : null
}

export async function wbFetch<T = any>(url: string, init: RequestInit = {}): Promise<{ status: number; body: T & { ok?: boolean; error?: string } }> {
  const token = await getToken()
  if (!token) return { status: 401, body: { ok: false, error: "Please sign in again." } as any }
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    })
    const body = await res.json().catch(() => ({ ok: false, error: `Request failed (${res.status})` }))
    return { status: res.status, body }
  } catch {
    return { status: 0, body: { ok: false, error: "Network error. Try again." } as any }
  }
}

export type Comment = {
  id: string
  section_id: string
  field_key: string | null
  kind: "coach_comment" | "coach_suggestion" | "client_question" | "coach_answer"
  parent_id: string | null
  body: string
  suggested_value: unknown
  suggestion_status: "pending" | "accepted" | "kept_own" | null
  author_role: "client" | "coach"
  author_id: string
  released_at: string | null
  created_at: string
}

export type Send = { id: string; direction: "to_coach" | "to_client"; sent_at: string; item_count: number; opened_at: string | null }

export function fmtWhen(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
}
