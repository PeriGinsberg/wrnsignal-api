// app/api/public/sow/[token]/accept/route.ts
//
// POST { name } is Let's Go: the client accepts their SOW from the private
// link. No login: the link's code is the key. Only the first acceptance
// counts; a repeat answers with the acceptance already on record. Rate limited
// per address like the booking form. The order of what follows is in
// lib/sow/accept.ts.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin } from "../../../../_lib/coachAuth"
import { underLimit } from "@/lib/prospects/bookingSpam"
import { getAppUrl } from "@/lib/urls"
import { acceptSow } from "@/lib/sow/accept"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Making the Drive workspace is eight Drive calls.
export const maxDuration = 60

const ipHits = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  return (xff ? xff.split(",")[0]?.trim() : "") || req.headers.get("x-real-ip") || ""
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!underLimit(ipHits, clientIp(req), 10, 10 * 60_000)) {
      return withCorsJson(req, { ok: false, error: "Too many tries. Please wait a few minutes and try again." }, 429)
    }
    const { token } = await params
    const body = await req.json().catch(() => ({}))
    const r = await acceptSow(getSupabaseAdmin(), token, body?.name, { appUrl: getAppUrl(req) })
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, accepted: r })
  } catch (e) {
    console.error("[public/sow/accept]", e instanceof Error ? e.stack : e)
    return withCorsJson(req, { ok: false, error: "Something went wrong. Please try again, or reply to the email your link came in." }, 500)
  }
}
