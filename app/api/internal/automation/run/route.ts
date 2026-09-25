// app/api/internal/automation/run/route.ts
//
// Drains the automation queue.
//
// THE SAFETY NET, NOT THE PRIMARY PATH. Every place that emits an event also
// drains right after, so the chain moves while the coach is still looking at
// the screen. This exists for the event whose drain failed midway, or was
// emitted by something that could not wait: those rows sit unprocessed with an
// error, and a run here picks them up.
//
// Safe to call at any time. An empty queue is a no-op.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { drain } from "@/lib/automation/run"

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
    const db = getSupabaseAdmin()
    const results = await drain(db)

    const byOutcome: Record<string, number> = {}
    for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1

    const errors = results.filter((r) => r.outcome === "error")
    for (const e of errors) console.error(`[automation] event ${e.eventId}: ${e.detail}`)

    // Reported separately from the drain: a row left unprocessed after a full
    // drain is the one thing this endpoint exists to notice.
    const { count: stuck } = await db.from("coach_automation_events")
      .select("*", { count: "exact", head: true }).is("processed_at", null)

    if (stuck) console.error(`[automation] ${stuck} events still unprocessed after draining`)

    return Response.json({
      ok: true,
      processed: results.length,
      outcomes: byOutcome,
      errors: errors.map((e) => ({ event: e.eventId, detail: e.detail })),
      still_queued: stuck ?? 0,
    })
  } catch (err: any) {
    console.error("[automation]", err?.stack || err?.message)
    return Response.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
