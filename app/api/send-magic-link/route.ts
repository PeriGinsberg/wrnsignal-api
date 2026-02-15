// app/api/send-magic-link/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Redirect after user clicks the magic link
const INTAKE_REDIRECT_URL = "https://www.workforcereadynow.com/signal/intake"

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
        { ok: false, error: "missing_required_fields", required: ["claim_token", "seat_email"] },
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
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .single()

    if (seatErr || !seat) {
      return withCorsJson(req, { ok: true, sent: false, reason: "invalid_or_expired" }, 200)
    }

    // Send magic link
    const { error: linkErr } = await supabaseAdmin.auth.signInWithOtp({
      email: seat_email,
      options: { emailRedirectTo: INTAKE_REDIRECT_URL },
    })

    if (linkErr) {
      return withCorsJson(req, { ok: false, error: linkErr.message }, 400)
    }

    // Optional: update status. If your DB constraint doesn't allow this value, ignore the error.
    try {
      await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", seat.id)
    } catch {
      // no-op
    }

    return withCorsJson(
      req,
      { ok: true, sent: true, intended_user_name: seat.intended_user_name },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
