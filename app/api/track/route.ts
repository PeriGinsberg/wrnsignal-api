import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Accept session_id from client if provided, otherwise generate one
    const sessionId = body.session_id
      ? String(body.session_id).slice(0, 200)
      : crypto.randomUUID()

    await supabase.from("jobfit_page_views").insert({
      session_id: sessionId,
      page_path: String(body.page_path ?? "/").slice(0, 200),
      page_name: String(body.page_name ?? "pageview").slice(0, 100),
      referrer: body.referrer ? String(body.referrer).slice(0, 500) : null,
      utm_source: body.utm_source ? String(body.utm_source).slice(0, 100) : null,
      utm_medium: body.utm_medium ? String(body.utm_medium).slice(0, 100) : null,
      utm_campaign: body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null,
      utm_content: body.utm_content ? String(body.utm_content).slice(0, 100) : null,
      utm_term: body.utm_term ? String(body.utm_term).slice(0, 100) : null,
    })

    return withCorsJson(req, { ok: true }, 200)
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message }, 500)
  }
}
