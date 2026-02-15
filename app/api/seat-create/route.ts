// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ---------- CORS ----------
export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

// ---------- Helpers ----------
function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function normalizeEmail(email: string) {
  return (email || "").trim().toLowerCase()
}

function toText(v: any) {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v.trim()
  // numbers/booleans get stringified
  return String(v).trim()
}

/**
 * GHL webhooks can arrive in a few shapes depending on the action type:
 * - Top-level keys
 * - Nested under customData/custom_data
 * - Nested under data / data.customData
 *
 * This safely picks the first non-empty candidate.
 */
function pick(body: any, key: string) {
  const candidates = [
    body?.[key],
    body?.customData?.[key],
    body?.custom_data?.[key],
    body?.data?.[key],
    body?.data?.customData?.[key],
    body?.data?.custom_data?.[key],
  ]
  for (const c of candidates) {
    const t = toText(c)
    if (t) return t
  }
  return ""
}

/**
 * Parse request body with fallbacks.
 * Some webhook implementations can send a JSON body; others can send form-encoded.
 * We try JSON first; if it fails, try form data.
 */
async function readBody(req: Request) {
  // Try JSON first
  try {
    return await req.json()
  } catch {
    // Fallback: try formData (application/x-www-form-urlencoded or multipart)
    try {
      const fd = await req.formData()
      const out: Record<string, any> = {}
      for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : String(v)
      return out
    } catch {
      return {} as any
    }
  }
}

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    // Webhook auth
    const secret = req.headers.get("x-webhook-secret") || ""
    if (!GHL_WEBHOOK_SECRET || secret !== GHL_WEBHOOK_SECRET) {
      return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
    }

    const body = await readBody(req)

    // Pull fields from multiple possible webhook shapes
    const order_id = pick(body, "order_id") || pick(body, "orderId") || pick(body, "orderID")
    const ghl_contact_id =
      pick(body, "ghl_contact_id") || pick(body, "contact_id") || pick(body, "contactId")
    const purchaser_email = normalizeEmail(
      pick(body, "purchaser_email") || pick(body, "purchaserEmail") || pick(body, "email")
    )
    const seat_email = normalizeEmail(
      pick(body, "seat_email") || pick(body, "seatEmail") || pick(body, "signal_user_email")
    )
    const intended_user_name =
      pick(body, "intended_user_name") || pick(body, "intendedUserName") || pick(body, "signal_user_name")

    // Validate required fields
    const missing: string[] = []
    if (!order_id) missing.push("order_id")
    if (!seat_email) missing.push("seat_email")
    if (!intended_user_name) missing.push("intended_user_name")

    if (missing.length) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "missing_required_fields",
          required: ["order_id", "seat_email", "intended_user_name"],
          missing,
          // DEV-only hint: helps confirm what shape we received without dumping the full payload
          received_keys: Object.keys(body || {}),
        },
        400
      )
    }

    // Generate raw token (never store raw)
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    // Insert seat (service role bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from("signal_seats")
      .insert({
        order_id,
        ghl_contact_id: ghl_contact_id || null,
        purchaser_email: purchaser_email || null,
        seat_email,
        intended_user_name,
        intended_user_email: seat_email, // keep aligned since seat_email is canonical
        claim_token_hash,
        status: "created",
      })
      .select("id")
      .single()

    if (error) {
      return withCorsJson(req, { ok: false, error: error.message }, 400)
    }

    // DEV claim URL points to Framer dev site
    const claim_url = `https://genuine-times-909123.framer.app/start?claim=${rawToken}`

    return withCorsJson(
      req,
      {
        ok: true,
        seat_id: data.id,
        claim_url,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
