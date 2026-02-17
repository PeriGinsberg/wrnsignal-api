// app/api/seat-create/route.ts
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

// ---------- ENV ----------
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

function isUniqueViolation(errMsg?: string) {
  const m = (errMsg || "").toLowerCase()
  return m.includes("duplicate key value") || m.includes("unique constraint")
}

// ---------- GHL update ----------
async function updateGhlMagicLink(args: { contactId: string; magicLink: string }) {
  const token = requireEnv("GHL_API_KEY", GHL_API_KEY)
  const locationId = requireEnv("GHL_LOCATION_ID", GHL_LOCATION_ID)
  const fieldId = requireEnv("GHL_MAGIC_LINK_FIELD_ID", GHL_MAGIC_LINK_FIELD_ID)

  // LeadConnector contact update endpoint
  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(args.contactId)}`

  // IMPORTANT:
  // - DO NOT put locationId in the JSON body (GHL returns 422).
  // - If location context is needed, pass it as a header.
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
      // Some GHL accounts require this header, some ignore it. Safe to include.
      LocationId: locationId,
    },
    body: JSON.stringify({
      customFields: [
        {
          id: fieldId,
          value: args.magicLink,
        },
      ],
    }),
  })

  const raw = await res.text()
  return { ok: res.ok, status: res.status, raw }
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

    const missing: string[] = []
    if (!order_id) missing.push("order_id")
    if (!ghl_contact_id) missing.push("ghl_contact_id")
    if (!seat_email) missing.push("seat_email")
    if (!intended_user_name) missing.push("intended_user_name")

    if (missing.length) {
      return withCorsJson(
        req,
        { ok: false, error: "missing_required_fields", missing, received_keys: Object.keys(body || {}) },
        400
      )
    }

    // Token for claim + hash for storage
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    // Try insert seat
    let seatId: string | null = null

    const insertRes = await supabaseAdmin
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

    if (insertRes.error) {
      // If a seat already exists (active), rotate token instead of failing.
      if (isUniqueViolation(insertRes.error.message)) {
        const existing = await supabaseAdmin
          .from("signal_seats")
          .select("id, used_at")
          .eq("seat_email", seat_email)
          .is("used_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (existing.data?.id) {
          seatId = existing.data.id

          const upd = await supabaseAdmin
            .from("signal_seats")
            .update({
              order_id,
              ghl_contact_id,
              purchaser_email: purchaser_email || null,
              intended_user_name,
              intended_user_email: seat_email,
              claim_token_hash,
              status: "created",
            })
            .eq("id", seatId)

          if (upd.error) {
            return withCorsJson(req, { ok: false, error: upd.error.message }, 400)
          }
        } else {
          return withCorsJson(req, { ok: false, error: insertRes.error.message }, 400)
        }
      } else {
        return withCorsJson(req, { ok: false, error: insertRes.error.message }, 400)
      }
    } else {
      seatId = insertRes.data.id
    }

    // Generate magic link (NO Supabase email, since GHL emails it)
    const redirectTo = requireEnv("INTAKE_REDIRECT_URL", INTAKE_REDIRECT_URL)
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: seat_email,
      options: { redirectTo },
    })

    if (linkErr) {
      return withCorsJson(req, { ok: false, error: linkErr.message }, 400)
    }

    const magic_link = (linkData as any)?.properties?.action_link
    if (!magic_link) {
      return withCorsJson(req, { ok: false, error: "missing_action_link" }, 500)
    }

    // Write magic link to GHL
    const ghl = await updateGhlMagicLink({ contactId: ghl_contact_id, magicLink: magic_link })

    // Mark seat as sent if GHL update worked (best effort)
    if (ghl.ok) {
      try {
        await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", seatId)
      } catch {}
    }

    const claim_url = `https://genuine-times-909123.framer.app/start?claim=${rawToken}`

    return withCorsJson(
      req,
      {
        ok: true,
        accepted: true,
        seat_id: seatId,
        claim_url,
        ghl_update_ok: ghl.ok,
        ghl_update_status: ghl.status,
        ghl_update_method: "PUT",
        ghl_update_raw_preview: (ghl.raw || "").slice(0, 500),
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, accepted: false, reason: "server_error", error: err?.message || "server_error" }, 200)
  }
}
