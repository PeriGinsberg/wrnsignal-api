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

function safeText(s: any) {
  return typeof s === "string" ? s.trim() : ""
}

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    // Webhook auth
    const secret = req.headers.get("x-webhook-secret") || ""
    if (!GHL_WEBHOOK_SECRET || secret !== GHL_WEBHOOK_SECRET) {
      return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
    }

    const body = await req.json().catch(() => ({} as any))

    const order_id = safeText(body.order_id)
    const ghl_contact_id = safeText(body.ghl_contact_id)
    const purchaser_email = normalizeEmail(body.purchaser_email)
    const seat_email = normalizeEmail(body.seat_email)
    const intended_user_name = safeText(body.intended_user_name)

    if (!order_id || !seat_email || !intended_user_name) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "missing_required_fields",
          required: ["order_id", "seat_email", "intended_user_name"],
        },
        400
      )
    }

    // Generate raw token (never store raw)
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    // Insert seat (RLS does not matter because service role bypasses it)
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
        // expires_at uses table default if set; otherwise you can set it explicitly here
      })
      .select("id")
      .single()

    if (error) {
      // If you have a unique index on seat_email where used_at is null,
      // this will throw when seat already exists. That is fine.
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
    return withCorsJson(
      req,
      { ok: false, error: err?.message || "server_error" },
      500
    )
  }
}
