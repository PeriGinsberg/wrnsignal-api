// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET

// GHL (Private Integration)
const GHL_API_KEY = process.env.GHL_API_KEY
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID

// Where your claim link begins (Framer start page)
// e.g. https://genuine-times-909123.framer.app/start
const CLAIM_BASE_URL = process.env.CLAIM_BASE_URL

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

async function updateGhlContactMagicLink(args: {
  contactId: string
  magicLink: string
}) {
  // Hard requirement for this feature
  requireEnv("GHL_API_KEY", GHL_API_KEY)
  requireEnv("GHL_LOCATION_ID", GHL_LOCATION_ID)

  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(args.contactId)}`

  // NOTE: GHL expects customFields array with key/value
  const payload = {
    locationId: GHL_LOCATION_ID,
    customFields: [
      { key: "signal_magic_link", value: args.magicLink },
    ],
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      "Content-Type": "application/json",
      // This version header is required by many GHL endpoints
      Version: "2021-07-28",
    } as any,
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`GHL update failed (${res.status}): ${text}`)
  }

  return text
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

    // Pull fields from multiple shapes
    const order_id = pick(body, "order_id") || pick(body, "orderId") || pick(body, "orderID")

    // IMPORTANT: For your case, this IS the purchaser contact id in GHL
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
    if (!ghl_contact_id) missing.push("ghl_contact_id") // purchaser contact
    if (!seat_email) missing.push("seat_email")
    if (!intended_user_name) missing.push("intended_user_name")

    if (missing.length) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "missing_required_fields",
          required: ["order_id", "ghl_contact_id", "seat_email", "intended_user_name"],
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

    // Build claim URL that starts the flow (your /start page)
    const base = requireEnv("CLAIM_BASE_URL", CLAIM_BASE_URL).replace(/\/+$/, "")
    const claim_url = `${base}?claim=${encodeURIComponent(rawToken)}`

    // ✅ Write the link back to the PURCHASER contact so your email merge works
    let ghl_updated = false
    let ghl_error: string | null = null

    try {
      await updateGhlContactMagicLink({
        contactId: ghl_contact_id,
        magicLink: claim_url,
      })
      ghl_updated = true

      // Optional: update seat status
      try {
        await supabaseAdmin.from("signal_seats").update({ status: "link_written" }).eq("id", data.id)
      } catch {
        // no-op
      }
    } catch (e: any) {
      ghl_error = e?.message || "ghl_update_failed"
    }

    return withCorsJson(
      req,
      {
        ok: true,
        seat_id: data.id,
        claim_url,
        ghl_updated,
        ghl_error,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
