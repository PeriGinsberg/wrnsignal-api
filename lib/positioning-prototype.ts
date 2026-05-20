// lib/positioning-prototype.ts
//
// Shared client helpers for the Phase 2 frontend prototype routes
// under app/positioning/phase2/. Centralizes:
//   - getToken(): Supabase session token + Framer-handoff fallback
//   - apiCall<T>(): typed fetch wrapper with auth header + error normalization
//   - Response type aliases matching the 5 Phase 2 endpoints
//
// This is prototype-scoped. When Phase 2 UI ports to Framer, this file
// won't ship — Framer pages will use their own fetch wrappers. Keeping
// the helper here means the Next.js prototype pages stay terse.

import { getSupabaseBrowser } from "./supabase-browser"
import type {
  PhaseTwoItem,
  PhaseTwoState,
  PhaseTwoRunStatus,
} from "./positioning/v2/phase2/types"

// ============================================================================
// Token retrieval (same pattern as app/dashboard/page.tsx:153-158)
// ============================================================================

/**
 * Get the current auth token. Prefers Supabase session access_token;
 * falls back to handoff token stored from Framer redirect.
 */
export async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  if (typeof window !== "undefined") {
    return sessionStorage.getItem("signal_handoff_token")
  }
  return null
}

// ============================================================================
// apiCall — typed fetch wrapper
// ============================================================================

/**
 * Result envelope for apiCall. Discriminated on `ok`:
 *   - ok=true: data parsed from the JSON response body
 *   - ok=false: HTTP status + normalized error code + optional detail
 *     Common error codes match what the Phase 2 endpoints return:
 *     phase2_run_not_found, item_not_found, item_already_decided,
 *     cost_cap_exceeded, grounding_failed, persona_cap_exceeded, etc.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; detail?: string }

/**
 * Make an authenticated request to a SIGNAL API endpoint and return a
 * typed result envelope. Adds Authorization header from getToken().
 * Auto-adds Content-Type: application/json for non-GET methods unless
 * the caller provides one.
 *
 * Failure modes:
 *   - No token → { ok: false, status: 401, error: "no_token" }
 *   - Network error → { ok: false, status: 0, error: "network_error" }
 *   - HTTP non-2xx → { ok: false, status, error, detail? } (parsed from body)
 *   - JSON parse failure on success response → { ok: true, data: null as T }
 *     (caller's type assertion responsibility)
 */
export async function apiCall<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const token = await getToken()
  if (!token) {
    return { ok: false, status: 401, error: "no_token" }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((init?.headers as Record<string, string>) ?? {}),
  }
  if (init?.method && init.method !== "GET" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json"
  }

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: "network_error",
      detail: (e as Error).message,
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const b = (body ?? {}) as Record<string, unknown>
    return {
      ok: false,
      status: res.status,
      error: typeof b.error === "string" ? b.error : `http_${res.status}`,
      detail: typeof b.detail === "string" ? b.detail : undefined,
    }
  }

  return { ok: true, data: body as T }
}

// ============================================================================
// Response type aliases for the 5 Phase 2 endpoints
// ============================================================================

/** Response from GET /api/positioning/v2/phase2/[id] (per FRD §6.5.2).
 *  D2 added `original_resume_text` (verbatim persona.resume_text) so the
 *  bullet picker can extract resume bullets client-side without hitting
 *  a separate endpoint. Null only when the persona lookup misses (race
 *  with persona deletion) — production paths always return a string. */
export type Phase2RunResponse = {
  phase2_run_id: string
  positioning_run_id: string
  persona_id: string
  case_letter: "A" | "B" | "C"
  state: PhaseTwoState
  revised_resume_text: string | null
  /** D2: verbatim persona.resume_text for client-side bullet extraction. */
  original_resume_text: string | null
  status: PhaseTwoRunStatus
  new_persona_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

/** Response from POST /api/positioning/v2/phase2/start (per FRD §6.5.1). */
export type Phase2StartResponse = {
  phase2_run_id: string
  state: PhaseTwoState
  status: PhaseTwoRunStatus
}

/** Response from POST /api/positioning/v2/phase2/[id]/draft (per FRD §6.5.3). */
export type Phase2DraftResponse = {
  drafts: string[]
  item_id: string
  generated_at: string
}

/** Response from POST /api/positioning/v2/phase2/[id]/decide (per FRD §6.5.4). */
export type Phase2DecideResponse = {
  state: PhaseTwoState
  revised_resume_text: string
}

/** Response from POST /api/positioning/v2/phase2/[id]/complete (per FRD §6.5.5). */
export type Phase2CompleteResponse = {
  phase2_run_id: string
  status: "completed"
  new_persona_id: string | null
  revised_resume_text: string
}

// Re-export the phase2 item/state types for convenience in prototype pages.
export type { PhaseTwoItem, PhaseTwoState, PhaseTwoRunStatus }
