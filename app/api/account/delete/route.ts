// app/api/account/delete/route.ts
//
// Authenticated account deletion for Apple App Store guideline 5.1.1(v)
// compliance. Users can delete their account + all user-owned data from
// inside the iOS app.
//
// Deletion order:
//   1. Verify bearer token → resolve userId + email
//   2. Look up the client_profile row
//   3. Hard-delete user-owned rows across 10 tables
//      (best-effort, per-table try/catch — warnings are returned, not thrown)
//   4. Anonymize purchases rows by email (keeps financial audit trail,
//      strips PII + attribution signals)
//   5. Hard-delete client_profiles row
//   6. Delete the Supabase auth.users row via admin API (requires service
//      role key — regular client cannot)
//
// If auth user deletion (step 6) fails, the endpoint returns 500 with
// warnings listed — the user is partially deleted. Prior steps may
// already have committed, so re-running is safe (idempotent on empty
// result sets).

import { type NextRequest } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request): string {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(
  req: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; email: string | null }> {
  const token = getBearerToken(req)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return {
    userId: data.user.id,
    email: (data.user.email ?? "").trim().toLowerCase() || null,
  }
}

type Warning = { step: string; error: string }

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(req: NextRequest) {
  const warnings: Warning[] = []
  const supabase = getSupabaseAdmin()

  // ── 1. Auth ──────────────────────────────────────────────────
  let userId: string
  let email: string | null
  try {
    const u = await getAuthedUser(req, supabase)
    userId = u.userId
    email = u.email
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { success: false, error: msg }, status)
  }

  // ── 2. Look up the user's client_profile id ──────────────────
  let profileId: string | null = null
  try {
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle()
    profileId = profile?.id ?? null
  } catch (err: any) {
    warnings.push({
      step: "lookup_profile",
      error: err?.message || String(err),
    })
  }

  // ── 3. Delete user-owned rows across 10 tables ───────────────
  if (profileId) {
    // Tables that link directly via client_profile_id
    const directTables = [
      "signal_applications",
      "jobfit_runs",
      "positioning_runs",
      "coverletter_runs",
      "networking_runs",
      "client_personas",
      "resume_rx_sessions",
    ]
    for (const table of directTables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("client_profile_id", profileId)
      if (error) {
        warnings.push({ step: `delete_${table}`, error: error.message })
      }
    }

    // Coach tables — user may be the coach OR the client in any given row.
    // Delete every row where either identifier matches.
    for (const table of [
      "coach_annotations",
      "coach_job_recommendations",
      "coach_clients",
    ]) {
      const { error: asClient } = await supabase
        .from(table)
        .delete()
        .eq("client_id", profileId)
      if (asClient) {
        warnings.push({
          step: `delete_${table}_as_client`,
          error: asClient.message,
        })
      }
      const { error: asCoach } = await supabase
        .from(table)
        .delete()
        .eq("coach_id", userId)
      if (asCoach) {
        warnings.push({
          step: `delete_${table}_as_coach`,
          error: asCoach.message,
        })
      }
    }

    // signal_interviews: FK to signal_applications. Most interview rows
    // are already gone via cascade from step above if the FK is configured
    // that way; otherwise they orphan with no PII attached. No direct
    // client_profile_id column to query on.
  }

  // ── 4. Anonymize purchases rows (keep financial audit trail) ─
  if (email) {
    const anonEmail = `deleted-${profileId ?? userId}@deleted.invalid`
    const { error } = await supabase
      .from("purchases")
      .update({
        email: anonEmail,
        referrer: null,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        utm_content: null,
        utm_term: null,
        landing_page: null,
        fbclid: null,
        ttclid: null,
        gclid: null,
        fbp: null,
        fbc: null,
        ttp: null,
        client_ip: null,
        client_user_agent: null,
      })
      .eq("email", email)
    if (error) {
      warnings.push({ step: "anonymize_purchases", error: error.message })
    }
  }

  // ── 5. Delete client_profiles row (cascades FK SET NULL on purchases) ─
  if (profileId) {
    const { error } = await supabase
      .from("client_profiles")
      .delete()
      .eq("id", profileId)
    if (error) {
      warnings.push({ step: "delete_client_profile", error: error.message })
    }
  }

  // ── 6. Delete Supabase auth.users row (admin API — critical step) ─
  const { error: authErr } = await supabase.auth.admin.deleteUser(userId)
  if (authErr) {
    return withCorsJson(
      req,
      {
        success: false,
        error: `Failed to delete auth user: ${authErr.message}`,
        warnings,
      },
      500
    )
  }

  return withCorsJson(
    req,
    {
      success: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    200
  )
}
