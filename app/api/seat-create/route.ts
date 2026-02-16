// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET

// ✅ Where the magic link should land after auth
// Set this in Vercel for both staging + prod.
// Staging example:
//   https://genuine-times-909123.framer.app/signal/intake
// Prod example:
//   https://wrnsignal.workforcereadynow.com/signal/intake
const INTAKE_REDIRECT_URL = process.env.INTAKE_REDIRECT_URL

// Optional kill switch (nice for testing)
const AUTO_SEND_MAGIC_LINK = (process.env.AUTO_SEND_MAGIC_LINK || "true") === "true"

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
  return String(v).trim()
}

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

async function readBody(req: Request) {
  try {
    return await req.json()
  } catch {
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
      pick(body, "intended_user_name") ||
      pick(body, "intendedUserName") ||
      pick(body, "signal_user_name")

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
          received_keys: Object.keys(body || {}),
        },
        400
      )
    }

    // Generate raw token (never store raw)
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    // Insert seat
    const { data, error } = await supabaseAdmin
      .from("signal_seats")
      .insert({
        order_id,
        ghl_contact_id: ghl_contact_id || null,
        purchaser_email: purchaser_email || null,
        seat_email,
        intended_user_name,
        intended_user_email: seat_email,
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

    // ✅ AUTO EMAIL MAGIC LINK RIGHT AFTER PURCHASE
    let email_sent = false
    let email_error: string | null = null

    if (AUTO_SEND_MAGIC_LINK) {
      try {
        const redirect = requireEnv("INTAKE_REDIRECT_URL", INTAKE_REDIRECT_URL)

        const { error: otpErr } = await supabaseAdmin.auth.signInWithOtp({
          email: seat_email,
          options: { emailRedirectTo: redirect },
        })

        if (otpErr) {
          email_error = otpErr.message
        } else {
          email_sent = true
          // update status to sent
          try {
            await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", data.id)
          } catch {
            // no-op
          }
        }
      } catch (e: any) {
        email_error = e?.message || "email_send_failed"
      }
    }

    return withCorsJson(
      req,
      {
        ok: true,
        seat_id: data.id,
        claim_url, // dev helper
        email_sent,
        email_error,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
