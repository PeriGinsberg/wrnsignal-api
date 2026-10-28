// app/api/internal/coach-jobs/send-emails/route.ts
//
// Every 5 minutes (vercel.json): emails clients about jobs their coach added,
// one email per coach and client once the oldest queued job is 10 minutes old.
// See lib/email/sendCoachJobEmails.ts. So a job's email goes 10 to 15 minutes
// after the coach adds it.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sendDueCoachJobEmails } from "@/lib/email/sendCoachJobEmails"
import { getAppUrl } from "@/lib/urls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  try {
    const results = await sendDueCoachJobEmails(getSupabaseAdmin(), { appUrl: getAppUrl(req) })
    const notSent = results.filter((r) => r.outcome !== "sent")
    if (results.length) console.log(`[coach-job-email] batches: ${results.length}, sent: ${results.length - notSent.length}`)
    for (const r of notSent) console.warn(`[coach-job-email] ${r.outcome} for client ${r.clientProfileId}: ${r.detail}`)
    return Response.json({
      ok: true,
      sent: results.length - notSent.length,
      not_sent: notSent.map((r) => ({ client: r.clientProfileId, coach: r.coachProfileId, jobs: r.jobs, outcome: r.outcome, reason: r.detail })),
    })
  } catch (err: any) {
    console.error("[coach-job-email]", err?.stack || err?.message)
    return Response.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
