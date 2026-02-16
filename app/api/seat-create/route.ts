// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET

const INTAKE_REDIRECT_URL = process.env.INTAKE_REDIRECT_URL

const GHL_API_KEY = process.env.GHL_API_KEY
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID
const GHL_MAGIC_LINK_FIELD_ID = process.env.GHL_MAGIC_LINK_FIELD_ID

function requireEnv(name: string, v?: string) {
  if (!v) throw new Error(`Missing server env: ${name}`)
  return v
}

const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL", SUPABASE_URL),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

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

async function updateGhlMagicLink(args: {
  contactId: string
  magicLink: string
}) {
  const token = requireEnv("GHL_API_KEY", GHL_API_KEY)
  const locationId = requireEnv("GHL_LOCATION_ID", GHL_LOCATION_ID)
  const fieldId = requireEnv("GHL_MAGIC_LINK_FIELD_ID", GHL_MAGIC_LINK_FIELD_ID)

  // LeadConnector (GHL v2) contact update
  // If this 404s for your account, tell me what base URL your GHL docs show and we’ll swap it.
  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(args.contactId)}`

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      locationId,
      customFields: [
        {
          id: fieldId,
          value: args.magicLink,
        },
      ],
    }),
  })

  const raw = await res.text()
  if (!res.ok) {
    throw new Error(`GHL update failed (${res.status}): ${raw}`)
  }
  return raw
}

export async function POST(req: Request) {
  try {
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
      pick(body, "intended_user_name") || pick(body, "intendedUserName") || pick(body, "signal_user_name")

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
          missing,
          received_keys: Object.keys(body || {}),
        },
        400
      )
    }

    // Create seat token
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    const { data: seatRow, error: seatErr } = await supabaseAdmin
      .from("signal_seats")
      .insert({
        order_id,
        ghl_contact_id,
        purchaser_email: purchaser_email || null,
        seat_email,
        intended_user_name,
        intended_user_email: seat_email,
        claim_token_hash,
        status: "created",
      })
      .select("id")
      .single()

    if (seatErr) {
      return withCorsJson(req, { ok: false, error: seatErr.message }, 400)
    }

    // Generate magic link (no Supabase email)
    const redirectTo = requireEnv("INTAKE_REDIRECT_URL", INTAKE_REDIRECT_URL)
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: seat_email, // user email
      options: { redirectTo },
    })

    if (linkErr) {
      return withCorsJson(req, { ok: false, error: linkErr.message }, 400)
    }

    const magic_link = (linkData as any)?.properties?.action_link
    if (!magic_link) {
      return withCorsJson(req, { ok: false, error: "missing_action_link" }, 500)
    }

    // Write magic link into GHL custom field so the email can merge it
    await updateGhlMagicLink({ contactId: ghl_contact_id, magicLink: magic_link })

    // Mark seat as sent (best effort)
    try {
      await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", seatRow.id)
    } catch {}

    // Optional dev helper
    const claim_url = `https://genuine-times-909123.framer.app/start?claim=${rawToken}`

    return withCorsJson(
      req,
      {
        ok: true,
        seat_id: seatRow.id,
        claim_url,
        magic_link_written_to_ghl: true,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
