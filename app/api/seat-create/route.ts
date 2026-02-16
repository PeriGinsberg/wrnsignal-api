// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET

// Where Supabase magic link should land after auth
// Staging: https://genuine-times-909123.framer.app/signal/intake
// Prod:    https://wrnsignal.workforcereadynow.com/signal/intake
const INTAKE_REDIRECT_URL = process.env.INTAKE_REDIRECT_URL

// GHL: write the magic link back to the contact so your GHL email can include it
// You’ll store it in a Contact Custom Field key like: signal_magic_link
const GHL_ACCESS_TOKEN = process.env.GHL_ACCESS_TOKEN
const GHL_BASE_URL =
  (process.env.GHL_BASE_URL || "https://services.leadconnectorhq.com").replace(
    /\/+$/,
    ""
  )
const GHL_API_VERSION = process.env.GHL_API_VERSION || "2021-07-28"
const GHL_MAGIC_LINK_FIELD_KEY =
  process.env.GHL_MAGIC_LINK_FIELD_KEY || "signal_magic_link"

// Kill switches (useful in DEV)
const AUTO_CREATE_MAGIC_LINK =
  (process.env.AUTO_CREATE_MAGIC_LINK || "true") === "true"
const AUTO_PUSH_TO_GHL =
  (process.env.AUTO_PUSH_TO_GHL || "true") === "true"

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

/**
 * Webhook bodies vary. This picks the first non-empty candidate.
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
 * Parse request body with fallbacks (JSON first, then formData).
 */
async function readBody(req: Request) {
  try {
    return await req.json()
  } catch {
    try {
      const fd = await req.formData()
      const out: Record<string, any> = {}
      for (const [k, v] of fd.entries())
        out[k] = typeof v === "string" ? v : String(v)
      return out
    } catch {
      return {} as any
    }
  }
}

/**
 * Create a Supabase admin-generated magic link URL (no email sent).
 * This is ideal because you can put it into your own branded GHL email.
 */
async function createMagicLinkOrThrow(email: string, redirectTo: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  })

  if (error) throw new Error(error.message)

  const magic_link = (data as any)?.properties?.action_link as string | undefined
  if (!magic_link) throw new Error("missing_action_link")

  return magic_link
}

/**
 * Push the generated magic link back into GHL contact custom field.
 * This is what Step 4 actually is.
 */
async function pushMagicLinkToGhlOrThrow(opts: {
  ghl_contact_id: string
  magic_link: string
}) {
  const { ghl_contact_id, magic_link } = opts

  const token = requireEnv("GHL_ACCESS_TOKEN", GHL_ACCESS_TOKEN)
  const url = `${GHL_BASE_URL}/contacts/${encodeURIComponent(ghl_contact_id)}`

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      customFields: [{ key: GHL_MAGIC_LINK_FIELD_KEY, value: magic_link }],
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(
      `ghl_update_failed (${res.status}): ${raw || res.statusText}`
    )
  }

  // Some GHL endpoints return JSON, some return empty text.
  try {
    return JSON.parse(raw)
  } catch {
    return { ok: true }
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

    // Extract fields from webhook
    const order_id =
      pick(body, "order_id") || pick(body, "orderId") || pick(body, "orderID")

    const ghl_contact_id =
      pick(body, "ghl_contact_id") || pick(body, "contact_id") || pick(body, "contactId")

    const purchaser_email = normalizeEmail(
      pick(body, "purchaser_email") ||
        pick(body, "purchaserEmail") ||
        pick(body, "email")
    )

    const seat_email = normalizeEmail(
      pick(body, "seat_email") ||
        pick(body, "seatEmail") ||
        pick(body, "signal_user_email")
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
    if (!ghl_contact_id) missing.push("ghl_contact_id")

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
    const { data: seatRow, error: seatErr } = await supabaseAdmin
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

    if (seatErr || !seatRow?.id) {
      return withCorsJson(req, { ok: false, error: seatErr?.message || "seat_insert_failed" }, 400)
    }

    // DEV helper claim URL (optional, but useful)
    const claim_url = `https://genuine-times-909123.framer.app/start?claim=${rawToken}`

    // Create magic link + push into GHL
    let magic_link: string | null = null
    let ghl_updated = false
    let ghl_error: string | null = null

    if (AUTO_CREATE_MAGIC_LINK && AUTO_PUSH_TO_GHL) {
      try {
        const redirect = requireEnv("INTAKE_REDIRECT_URL", INTAKE_REDIRECT_URL)
        magic_link = await createMagicLinkOrThrow(seat_email, redirect)

        await pushMagicLinkToGhlOrThrow({
          ghl_contact_id,
          magic_link,
        })

        ghl_updated = true

        // Update seat status
        try {
          await supabaseAdmin
            .from("signal_seats")
            .update({ status: "sent" })
            .eq("id", seatRow.id)
        } catch {
          // no-op
        }
      } catch (e: any) {
        ghl_error = e?.message || "magic_link_or_ghl_update_failed"
      }
    }

    return withCorsJson(
      req,
      {
        ok: true,
        seat_id: seatRow.id,
        claim_url, // dev helper
        magic_link_generated: Boolean(magic_link),
        ghl_updated,
        ghl_error,
        // Optional: only include the link in dev if you want
        // magic_link,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
