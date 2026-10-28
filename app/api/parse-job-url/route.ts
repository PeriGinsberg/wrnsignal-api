import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { parseJobUrl } from "@/lib/jobParse/parseJobUrl"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// The parsing lives in lib/jobParse/parseJobUrl.ts, shared with the supporter
// auto-fill route.

// ── CORS OPTIONS ──
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  let body: { url?: unknown }
  try {
    body = await req.json()
  } catch {
    return withCorsJson(req, { error: "Invalid JSON body", code: "INVALID_URL" }, 400)
  }
  const r = await parseJobUrl(body)
  return withCorsJson(req, r.body, r.status)
}
