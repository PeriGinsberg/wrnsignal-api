// app/api/runs/route.ts
//
// GET /api/runs
// Every JobFit run this student has done, newest first. Powers the Job
// Tracker's History view ("Jobs you've scored").
//
// This is the LIST sibling of /api/runs/[id], which returns one run in full.
// There was no client-side way to enumerate runs before this: the only reader
// of jobfit_runs-as-a-list was the coach tracker endpoint, scoped to a coach
// looking at someone else. A student could not see their own scoring history
// at all, which is what History exists to fix.
//
// Deliberately thin. It returns the four things a history row shows plus the
// ids needed to act on it, and NOT result_json, which is a large object per row
// and would make a 200-run history a multi-megabyte response. The full analysis
// is one click away through /api/runs/[id].

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getHistoryBoundary, applyHistoryBoundary } from "../_lib/clientHistoryBoundary"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Enough for any real student, and a ceiling so one account cannot hang the view. */
const MAX_RUNS = 300

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

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, user_id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles")
      .select("id, user_id")
      .eq("email", email)
      .maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }

  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Same returning-client clean slate the applications list honours. Without
    // it a student who restarted an engagement would see a fresh, empty tracker
    // and a History still full of the previous one.
    const boundaryAt = await getHistoryBoundary(supabase, profileId)

    // result_json IS selected, because company and title live inside it and
    // there are no top-level columns for them. The projection down to four
    // fields happens immediately below, so nothing large crosses the wire.
    const q = supabase
      .from("jobfit_runs")
      .select("id, created_at, verdict, result_json, application_id, job_url")
      .eq("client_profile_id", profileId)
    const { data, error } = await applyHistoryBoundary(q, boundaryAt)
      .order("created_at", { ascending: false })
      .limit(MAX_RUNS)

    if (error) throw new Error(`Run history lookup failed: ${error.message}`)

    const runs = (data ?? []).map((r: any) => ({
      id: r.id,
      created_at: r.created_at,
      // `decision` is the human band ("Apply", "Review"). `verdict` is the
      // older column and is the fallback for rows written before result_json
      // carried a decision.
      decision: r.result_json?.decision ?? r.verdict ?? null,
      score: r.result_json?.score ?? null,
      company_name: r.result_json?.job_signals?.companyName ?? null,
      job_title: r.result_json?.job_signals?.jobTitle ?? null,
      // The reverse link jobfit → application, stamped when a run auto-creates
      // a tracker entry. The client ALSO derives tracked-ness from the
      // applications list, which is the authority; this is here for the rows
      // where the application was deleted but the run remains.
      application_id: r.application_id ?? null,
      job_url: r.job_url ?? null,
    }))

    return withCorsJson(req, { ok: true, runs })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.includes("Profile not found")
        ? 404
        : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
