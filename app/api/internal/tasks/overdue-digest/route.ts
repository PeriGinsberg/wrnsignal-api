// app/api/internal/tasks/overdue-digest/route.ts
//
// One email per coach who has overdue tasks. Coaches with none get nothing.
//
// SCHEDULED AT 11:00 UTC, which is 7am Eastern while daylight saving is in
// effect and 6am once it ends. Vercel crons are UTC only and do not follow a
// timezone, so a fixed hour drifts by one twice a year. 11:00 was chosen over
// 12:00 because arriving an hour early in winter is better than arriving an
// hour after the working day has started. If the hour matters more than the
// simplicity, the fix is an hourly cron that returns early unless it is 7am in
// America/New_York; that is a real option, deliberately not taken yet.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sendOverdueDigests } from "@/lib/email/sendTaskEmails"

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
    const results = await sendOverdueDigests(getSupabaseAdmin())
    const sent = results.filter((r) => r.sent)
    const skipped = results.filter((r) => !r.sent)

    console.log(`[overdue-digest] coaches with overdue work: ${results.length}, sent: ${sent.length}`)
    for (const s of skipped) console.warn(`[overdue-digest] not sent to ${s.email || s.coachProfileId}: ${s.error}`)

    return Response.json({
      ok: true,
      coaches_with_overdue: results.length,
      sent: sent.length,
      // Reported rather than swallowed: "nobody was emailed" and "nobody had
      // overdue work" are different states and the run should say which.
      skipped: skipped.map((s) => ({ coach: s.coachProfileId, reason: s.error, count: s.count })),
      total_overdue_tasks: results.reduce((n, r) => n + r.count, 0),
    })
  } catch (err: any) {
    console.error("[overdue-digest]", err?.stack || err?.message)
    return Response.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
