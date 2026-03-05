// FILE: app/api/version/route.ts
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function pick(name: string) {
  return (process.env[name] ?? "").trim() || null
}

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: Request) {
  return withCorsJson(req, {
    env: pick("VERCEL_ENV") ?? pick("NODE_ENV") ?? "unknown",
    git_sha: pick("VERCEL_GIT_COMMIT_SHA") ?? pick("GIT_SHA"),
    jobfit_logic_version: pick("JOBFIT_LOGIC_VERSION"),
    route_jobfit_stamp: pick("ROUTE_JOBFIT_STAMP"),
    profile_v4_stamp: pick("PROFILE_V4_STAMP"),
    renderer_v4_stamp: pick("RENDERER_V4_STAMP"),
    taxonomy_v4_stamp: pick("TAXONOMY_V4_STAMP"),
    types_v4_stamp: pick("TYPES_V4_STAMP"),
    built_at_utc: new Date().toISOString(),
  })
}