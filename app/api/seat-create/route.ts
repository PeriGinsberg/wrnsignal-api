import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import crypto from "crypto"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex")
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const purchaser_email = String(body.purchaser_email ?? "")
      .trim()
      .toLowerCase()

    if (!purchaser_email) {
      return withCorsJson(req, { ok: false, error: "missing_purchaser_email" }, 400)
    }

    const supabaseUrl = requireEnv("SUPABASE_URL", process.env.SUPABASE_URL)
    const serviceRoleKey = requireEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const token = makeToken()
    const tokenHash = sha256(token)

    const { error } = await supabase.from("signal_seats").insert({
      purchaser_email,
      claim_token_hash: tokenHash,
      status: "unclaimed",
    })

    if (error) {
      return withCorsJson(req, { ok: false, error: error.message }, 500)
    }

    const claim_url = `https://wrnsignal.workforcereadynow.com/claim?token=${token}`

    return withCorsJson(req, { ok: true, claim_url }, 200)
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}
