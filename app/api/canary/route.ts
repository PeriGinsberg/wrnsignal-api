import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: Request) {
  const res = corsOptionsResponse(req.headers.get("origin"))
  res.headers.set("x-api-canary", "CANARY_ROUTE__2026_03_05__A")
  return res
}

export async function GET(req: Request) {
  return withCorsJson(req, {
    ok: true,
    canary: "CANARY_ROUTE__2026_03_05__A",
    vercel_env: (process.env.VERCEL_ENV ?? "").trim() || null,
    sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || null,
    built_at_utc: new Date().toISOString(),
  })
}
