// app/api/coach/engagement-signals/restore/route.ts
//
// Phase 3 Commit 3.2 — Undo for a just-dismissed engagement signal.
// Backs the toast's Undo button. Idempotent: deleting a non-existent
// dismissal row is a no-op. Coach-scoped — a coach can only un-dismiss
// their own dismissals.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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
    // Coach-scoped delete — only their own dismissal row is removable.
    // Idempotent: zero rows matched is not an error.
    const { error: delErr } = await supabase
      .from("coach_engagement_signal_dismissals")
      .delete()
      .eq("coach_profile_id", coachProfileId)
      .eq("signal_key", signalKey)
    if (delErr) throw new Error(`Restore failed: ${delErr.message}`)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
