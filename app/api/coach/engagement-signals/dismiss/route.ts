// app/api/coach/engagement-signals/dismiss/route.ts
//
// Phase 3 Commit 3.2 — coach dismisses an engagement signal. Inserts a
// row into coach_engagement_signal_dismissals; ON CONFLICT DO NOTHING
// so re-dismissals (e.g., re-click after Undo expired) are idempotent.
//
// The shared heuristic engine (app/api/_lib/coachEngagementHeuristics.ts)
// loads the dismissal set at the top of every runHeuristics() call and
// filters dismissed signal IDs from its output. As a result, dismissing
// on any of the three surfaces (Coach Home / Client Dashboard / Required
// Actions) propagates to the other two on next read — no per-surface
// client-side bookkeeping needed beyond the optimistic remove.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Engine `id` prefixes (locked Phase 3.0). signal_key MUST start with
// one of these to be a valid dismissal target. Defense in depth — the
// engine never emits IDs with other prefixes, but we don't trust
// arbitrary client input.
const VALID_KEY_PREFIXES = [
  "r1:",
  "r2:",
  "moved_interviewing:",
  "moved_rejected:",
  "offer_no_followup:",
  "r6:",
]

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

async function getCoachProfileId(userId: string, email: string | null): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from("client_profiles")
    .select("id, is_coach")
    .eq("user_id", userId)
    .maybeSingle()
  if (data) return data.is_coach ? (data.id as string) : null
  if (email) {
    const { data: byEmail } = await supabase
      .from("client_profiles")
      .select("id, is_coach")
      .eq("email", email)
      .maybeSingle()
    if (byEmail) return byEmail.is_coach ? (byEmail.id as string) : null
  }
  return null
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getCoachProfileId(userId, email)
    if (!coachProfileId) {
      return withCorsJson(req, { ok: false, error: "Forbidden: caller is not a coach" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }
    const signalKey = String((body as any).signal_key || "").trim()
    if (!signalKey) {
      return withCorsJson(req, { ok: false, error: "signal_key is required" }, 400)
    }
    if (!VALID_KEY_PREFIXES.some((p) => signalKey.startsWith(p))) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: `Invalid signal_key prefix. Allowed: ${VALID_KEY_PREFIXES.join(", ")}`,
        },
        400,
      )
    }

    const supabase = getSupabaseAdmin()
    // PostgREST: pass an empty onConflict target to use the existing
    // UNIQUE(coach_profile_id, signal_key) constraint; ignoreDuplicates
    // mirrors ON CONFLICT DO NOTHING.
    const { error: insertErr } = await supabase
      .from("coach_engagement_signal_dismissals")
      .upsert(
        { coach_profile_id: coachProfileId, signal_key: signalKey },
        { onConflict: "coach_profile_id,signal_key", ignoreDuplicates: true },
      )
    if (insertErr) throw new Error(`Dismiss failed: ${insertErr.message}`)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
