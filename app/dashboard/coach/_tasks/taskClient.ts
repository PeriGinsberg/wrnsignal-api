"use client"

// Shared browser-side helpers for the task surfaces.
//
// Underscore-prefixed parent dir keeps this out of Next.js routing, same as
// _action-items.
//
// The auth dance (session token, falling back to the handoff token in
// sessionStorage) is copied from the Required Actions page rather than
// imported from it, because that page defines it privately. Worth pulling into
// one place the next time a third surface needs it.

import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import type { Task } from "../../../../lib/tasks/model"

export type { Task }

export type Assignee = { id: string; name: string; email: string | null; active: boolean }

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  try {
    return sessionStorage.getItem("signal_handoff_token")
  } catch {
    return null
  }
}

export async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

/** Throws with the server's sentence, so callers can show it verbatim. */
export async function apiJson<T = any>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await authFetch(url, opts)
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
  return body as T
}

/**
 * How a due date reads in a list.
 *
 * due_has_time is why this is not a one-liner: a task given a day shows the day
 * and nothing else, because printing "12:00 AM" next to it would invent a
 * precision the coach never chose.
 */
export function formatDue(task: Pick<Task, "due_at" | "due_has_time">): string {
  if (!task.due_at) return "No due date"
  const d = new Date(task.due_at)
  if (Number.isNaN(d.getTime())) return "No due date"

  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  const day = sameDay
    ? "Today"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })

  if (!task.due_has_time) return day
  return `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
}

/**
 * Turn bare URLs in a description into links.
 *
 * The brief asks for clickable links. The description is stored as plain text
 * and rendered as text, so this splits on URLs rather than parsing markup:
 * anything that is not a match is still printed as the literal characters the
 * coach typed. That is the whole reason it is done this way instead of with
 * dangerouslySetInnerHTML, which would execute whatever a description happened
 * to contain.
 */
export function linkifyParts(text: string): Array<{ kind: "text" | "link"; value: string }> {
  const out: Array<{ kind: "text" | "link"; value: string }> = []
  const re = /(https?:\/\/[^\s<>"')]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: text.slice(last, m.index) })
    out.push({ kind: "link", value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) })
  return out
}
