// app/api/internal/match/check-links/route.ts
//
// Nightly: is each client's top 30 still open? See lib/match/linkCheck.ts.
// A page that says the job is closed takes the posting out of every queue;
// links that all answer 404/410 mark it likely closed (ranked last, still
// shown); a bot wall or an error is recorded as unknown and changes nothing.
//
// Runs after the ingest sweeps (03:00-03:15, 04:00-04:45) and before the morning review.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runLinkCheck } from "@/lib/match/linkCheck"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// The ingest crons' limit: an unknown link now also checks the posting's other links.
export const maxDuration = 800

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
  if (!authorised(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"

  const { error: probe } = await supabase.from("postings").select("closed_at").limit(1)
  if (probe) {
    return Response.json({ ok: true, skipped: `link check columns absent in this environment (${probe.message})`, environment })
  }

  const res = await runLinkCheck(supabase, { top: 30 })
  return Response.json({ ok: true, environment, ...res })
}
