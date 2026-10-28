import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { parseJobText } from "@/lib/jobParse/parseJobText"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// The parsing lives in lib/jobParse/parseJobText.ts, shared with the supporter
// auto-fill route.

// ── CORS OPTIONS ──
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  let body: { text?: unknown }
  try {
    body = await req.json()
  } catch {
    return withCorsJson(req, { error: "Invalid JSON body" }, 400)
  }
  const r = await parseJobText(body)
  return withCorsJson(req, r.body, r.status)
}
