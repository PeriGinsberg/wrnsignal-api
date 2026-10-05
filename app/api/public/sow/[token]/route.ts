// app/api/public/sow/[token]/route.ts
//
// GET a client's SOW by its private link code. No login: the code is the key
// (256 random bits, only its hash stored). Returns the copy that was sent, or
// 404 for a link that is unknown, old (re-sent) or withdrawn. Let's Go is
// Step 4.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin } from "../../../_lib/coachAuth"
import { getSowByToken } from "@/lib/sow/public"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const sow = await getSowByToken(getSupabaseAdmin(), token)
    if (!sow) return withCorsJson(req, { ok: false, error: "This link is no longer active." }, 404)
    return withCorsJson(req, { ok: true, sow })
  } catch {
    return withCorsJson(req, { ok: false, error: "Something went wrong. Please try again." }, 500)
  }
}
