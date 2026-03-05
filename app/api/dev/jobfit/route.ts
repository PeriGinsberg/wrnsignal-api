// FILE: app/api/dev/jobfit/route.ts
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: Request) {
  return withCorsJson(req, {
    ok: true,
    route: "/api/dev/jobfit",
    env: (process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"),
    built_at_utc: new Date().toISOString(),
  })
}
