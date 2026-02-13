import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const purchaser_email = String(body?.purchaser_email ?? "").trim().toLowerCase()
    if (!purchaser_email) {
      return withCorsJson(req, { ok: false, error: "missing_purchaser_email" }, 400)
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return withCorsJson(
        req,
        { ok: false, error: "server_misconfigured", detail: "Missing Supabase env vars" },
        500
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // TODO: your seat creation logic here
    // For now return a stub so we can prove CORS is fixed:
    return withCorsJson(req, { ok: true, purchaser_email }, 200)
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}
