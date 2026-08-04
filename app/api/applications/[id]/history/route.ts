// app/api/applications/[id]/history/route.ts
//
// GET /api/applications/:id/history
// Everything that has happened to one job, oldest event first, as one merged
// timeline. Powers the History drawer on the application detail page, the same
// idea as the contact record's History.
//
// NO NEW TABLE, NO MIGRATION. Every event here is already recorded somewhere;
// the gap was that nothing composed them and nothing client-facing could read
// the one table that mattered. Sources, in the order they contribute:
//
//   signal_applications.created_at            when it entered the tracker
//   signal_applications_status_history        every status transition since
//                                             2026-05-08, with who made it
//   signal_applications.applied_date          the user-entered send date
//   jobfit_runs.created_at                    each time the job was scored
//   signal_interviews.created_at              each round as it was booked
//   signal_interviews.interview_date          each round once it has happened
//   coach_annotations.created_at              coach notes the client can see
//
// THE ONE HONEST GAP. `signal_applications_status_history` was added
// 2026-05-08. Anything created before that has no transition rows, so its
// timeline starts from the derived events (added, applied, scored) and cannot
// show intermediate moves that were never recorded. Measured on prod at build
// time: 712 of 982 applications have transition rows, so roughly a quarter of
// the oldest jobs get the shorter timeline. Nothing is wrong on those, there is
// simply less of it, and no amount of new tracking can recover history that was
// never written.
//
// WHO DID IT. `changed_by` is a client_profiles id. Comparing it to the
// application's owner is what separates "you moved this" from "your coach moved
// this", which is the difference a student actually cares about.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Actor = "you" | "coach" | "system"

export type JobEvent = {
  /** Stable key so the client can pick an icon and a verb without parsing text. */
  kind: "added" | "status" | "applied" | "scored" | "interview_added" | "interview_held" | "coach_note"
  at: string
  actor: Actor
  /** Already-worded summary. The client styles it; it does not compose it. */
  label: string
  /** Optional second line: a score, a note excerpt, an interviewer. */
  detail?: string | null
  from_status?: string | null
  to_status?: string | null
}

const STATUS_WORDS: Record<string, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "No offer",
  withdrawn: "Withdrawn",
  coach_recommended: "Recommended by your coach",
}
const word = (s: string | null | undefined) =>
  s ? STATUS_WORDS[s] ?? s.replace(/_/g, " ") : "—"

const STAGE_WORDS: Record<string, string> = {
  hr_screening: "HR screening",
  phone: "Phone screen",
  zoom: "Video call",
  ai_hirevue: "AI / HireVue",
  in_person: "In-person interview",
  take_home: "Take-home",
  final_round: "Final round",
  other: "Interview",
}
const stageWord = (s: string | null | undefined) =>
  s ? STAGE_WORDS[s] ?? s.replace(/_/g, " ") : "Interview"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
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

/**
 * A bare "2026-07-21" from a `date` column, as an instant at LOCAL-ish noon.
 *
 * Noon, not midnight, so that formatting it in any reasonable client timezone
 * lands on the day the column actually says. This is the server-side half of
 * the same date-only problem lib/localDate.ts solves on the client: a `date`
 * has no instant, and picking midnight makes the answer depend on which side of
 * UTC the reader is standing.
 */
function dateOnlyToInstant(d: string | null): string | null {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00.000Z`
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return withCorsJson(req, { ok: false, error: "Missing application id" }, 400)

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Ownership gate. Service-role bypasses RLS, so this check is the access
    // control, not a convenience.
    const { data: app, error: appErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id, created_at, applied_date, application_status")
      .eq("id", id)
      .maybeSingle()
    if (appErr) throw new Error(`Application lookup failed: ${appErr.message}`)
    if (!app) return withCorsJson(req, { ok: false, error: "Not found" }, 404)
    if (app.profile_id !== profileId) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const [historyRes, runsRes, ivRes, annRes] = await Promise.all([
      supabase
        .from("signal_applications_status_history")
        .select("from_status, to_status, changed_at, changed_by")
        .eq("application_id", id)
        .order("changed_at", { ascending: true }),
      supabase
        .from("jobfit_runs")
        .select("id, created_at, verdict, result_json")
        .eq("application_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("signal_interviews")
        .select("id, created_at, interview_date, interview_stage, interviewer_names, status")
        .eq("application_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("coach_annotations")
        .select("id, note, created_at")
        .eq("target_id", id)
        .eq("target_type", "application")
        .eq("client_profile_id", profileId)
        .eq("visible_to_client", true)
        .order("created_at", { ascending: true }),
    ])

    const history = historyRes.data ?? []
    const events: JobEvent[] = []
    const actorOf = (changedBy: string | null): Actor =>
      !changedBy ? "system" : changedBy === app.profile_id ? "you" : "coach"

    // ── Added ────────────────────────────────────────────────────────────────
    // The creation row in status history has from_status = null. Use it when it
    // exists, because it names what the job was created AS; fall back to the
    // earliest transition's from_status, and finally to the current status for
    // rows that predate the table entirely.
    const createdRow = history.find((h) => h.from_status === null)
    const initialStatus =
      createdRow?.to_status ?? history[0]?.from_status ?? app.application_status
    events.push({
      kind: "added",
      at: createdRow?.changed_at ?? app.created_at,
      actor: actorOf(createdRow?.changed_by ?? null),
      label:
        initialStatus === "coach_recommended"
          ? "Added to your tracker by your coach"
          : "Added to your tracker",
      detail: initialStatus && initialStatus !== "saved" ? `as ${word(initialStatus)}` : null,
    })

    // ── Status moves ─────────────────────────────────────────────────────────
    for (const h of history) {
      if (h.from_status === null) continue // already the "added" event
      events.push({
        kind: "status",
        at: h.changed_at,
        actor: actorOf(h.changed_by),
        label: `Moved to ${word(h.to_status)}`,
        detail: `from ${word(h.from_status)}`,
        from_status: h.from_status,
        to_status: h.to_status,
      })
    }

    // ── Applied, when the transition was never recorded ──────────────────────
    // Pre-2026-05-08 jobs have no transition rows, and a job whose applied_date
    // was typed in by hand never generated one either. Only synthesised when
    // there is no real 'applied' transition, so the two can never double up.
    const hasAppliedMove = history.some((h) => h.to_status === "applied")
    const appliedInstant = dateOnlyToInstant(app.applied_date)
    if (!hasAppliedMove && appliedInstant) {
      events.push({ kind: "applied", at: appliedInstant, actor: "you", label: "Applied", detail: null })
    }

    // ── Scored ───────────────────────────────────────────────────────────────
    for (const r of (runsRes.data ?? []) as any[]) {
      const score = r.result_json?.score ?? null
      const decision = r.result_json?.decision ?? r.verdict ?? null
      events.push({
        kind: "scored",
        at: r.created_at,
        actor: "you",
        label: "Scored by SIGNAL",
        detail: [score != null ? String(score) : null, decision].filter(Boolean).join(" · ") || null,
      })
    }

    // ── Interviews: booked, and then held ────────────────────────────────────
    for (const iv of (ivRes.data ?? []) as any[]) {
      events.push({
        kind: "interview_added",
        at: iv.created_at,
        actor: "you",
        label: `${stageWord(iv.interview_stage)} added`,
        detail: iv.interviewer_names ? `with ${iv.interviewer_names}` : null,
      })
      // A future date is not history yet; the detail page's hero already counts
      // it down. Only add the round to the log once the day has passed.
      const held = dateOnlyToInstant(iv.interview_date)
      if (held && new Date(held).getTime() < Date.now()) {
        events.push({
          kind: "interview_held",
          at: held,
          actor: "you",
          label: `${stageWord(iv.interview_stage)} happened`,
          detail: null,
        })
      }
    }

    // ── Coach notes ──────────────────────────────────────────────────────────
    for (const ann of (annRes.data ?? []) as any[]) {
      const note = String(ann.note ?? "")
      events.push({
        kind: "coach_note",
        at: ann.created_at,
        actor: "coach",
        label: "Your coach left a note",
        detail: note.length > 90 ? `${note.slice(0, 90).trimEnd()}…` : note || null,
      })
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

    return withCorsJson(req, {
      ok: true,
      events,
      // True when this job predates the transition log, so the client can say
      // so plainly instead of implying nothing ever happened.
      partial: history.length === 0,
    })
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
