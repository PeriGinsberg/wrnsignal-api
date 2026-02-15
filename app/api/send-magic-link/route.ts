// app/api/send-magic-link/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// DEV redirect (where the link should land after auth)
const INTAKE_REDIRECT_URL = "https://genuine-times-909123.framer.app/signal/intake"

// Helps you confirm staging is running the new route
const VERSION = "dev-return-link-v1"

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

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any))

    const claim_token = toText(body.claim_token)
    const seat_email = normalizeEmail(body.seat_email)

    if (!claim_token || !seat_email) {
      return withCorsJson(
        req,
        { ok: false, error: "missing_required_fields", required: ["claim_token", "seat_email"], version: VERSION },
        400
      )
    }

    const claim_token_hash = sha256Hex(claim_token)

    // Re-verify seat (do NOT trust client)
    const { data: seat, error: seatErr } = await supabaseAdmin
      .from("signal_seats")
      .select("id, seat_email, intended_user_name, used_at, expires_at, status")
      .eq("claim_token_hash", claim_token_hash)
      .eq("seat_email", seat_email)
      .single()

    if (seatErr || !seat) {
      return withCorsJson(req, { ok: true, sent: false, reason: "invalid_or_expired", version: VERSION }, 200)
    }

    if (seat.used_at) {
      return withCorsJson(req, { ok: true, sent: false, reason: "already_used", version: VERSION }, 200)
    }

    if (seat.expires_at && new Date(seat.expires_at) < new Date()) {
      return withCorsJson(req, { ok: true, sent: false, reason: "expired", version: VERSION }, 200)
    }

    // ✅ DEV: generate magic link (NO EMAIL)
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: seat_email,
      options: {
        redirectTo: INTAKE_REDIRECT_URL,
      },
    })

    if (linkErr) {
      return withCorsJson(req, { ok: false, error: linkErr.message, version: VERSION }, 400)
    }

    const magic_link = (linkData as any)?.properties?.action_link
    if (!magic_link) {
      return withCorsJson(req, { ok: false, error: "missing_action_link", version: VERSION }, 500)
    }

    // Optional: update status. Ignore if DB constraint rejects it.
    try {
      await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", seat.id)
    } catch {
      // no-op
    }

    return withCorsJson(
      req,
      {
        ok: true,
        sent: true,
        intended_user_name: seat.intended_user_name,
        magic_link,
        version: VERSION,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error", version: VERSION }, 500)
  }
}
