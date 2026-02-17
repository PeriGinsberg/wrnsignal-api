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

// dual | legacy_only | new_only
const SIGNAL_ENTRY_MODE = (process.env.SIGNAL_ENTRY_MODE || "dual").toLowerCase()

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

function modeAllowsNewFlow() {
  return SIGNAL_ENTRY_MODE === "dual" || SIGNAL_ENTRY_MODE === "new_only"
}

function modeAllowsLegacyOnlyShortCircuit() {
  return SIGNAL_ENTRY_MODE === "legacy_only"
}

// ---------- GHL update ----------
async function updateGhlMagicLink(args: { contactId: string; magicLink: string }) {
  const token = requireEnv("GHL_API_KEY", GHL_API_KEY)
  const locationId = requireEnv("GHL_LOCATION_ID", GHL_LOCATION_ID)
  const fieldId = requireEnv("GHL_MAGIC_LINK_FIELD_ID", GHL_MAGIC_LINK_FIELD_ID)

  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(args.contactId)}`

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
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

// ---------- Seat upsert (idempotent) ----------
async function upsertActiveSeat(args: {
  order_id: string
  ghl_contact_id: string
  purchaser_email: string | null
  seat_email: string
  intended_user_name: string
  claim_token_hash: string
}) {
  // First try insert
  const insertRes = await supabaseAdmin
    .from("signal_seats")
    .insert({
      order_id: args.order_id,
      ghl_contact_id: args.ghl_contact_id,
      purchaser_email: args.purchaser_email,
      seat_email: args.seat_email,
      intended_user_name: args.intended_user_name,
      intended_user_email: args.seat_email,
      claim_token_hash: args.claim_token_hash,
      status: "created",
    })
    .select("id")
    .single()

  if (!insertRes.error) {
    return { seatId: insertRes.data.id, inserted: true as const }
  }

  // If duplicate, reuse existing active seat (used_at is null) and rotate token hash
  if (isUniqueViolation(insertRes.error.message)) {
    const existing = await supabaseAdmin
      .from("signal_seats")
      .select("id, used_at")
      .eq("seat_email", args.seat_email)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!existing.data?.id) {
      // Duplicate error but no active seat found (weird). Fail loudly.
      throw new Error(insertRes.error.message)
    }

    const seatId = existing.data.id

    const upd = await supabaseAdmin
      .from("signal_seats")
      .update({
        order_id: args.order_id,
        ghl_contact_id: args.ghl_contact_id,
        purchaser_email: args.purchaser_email,
        intended_user_name: args.intended_user_name,
        intended_user_email: args.seat_email,
        claim_token_hash: args.claim_token_hash,
        status: "created",
      })
      .eq("id", seatId)

    if (upd.error) throw new Error(upd.error.message)

    return { seatId, inserted: false as const }
  }

  throw new Error(insertRes.error.message)
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
      pick(body, "intended_user_name") || pick(body, "intendedUserName") || pick(body, "signal_user_name")

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

    // Always create/rotate a seat token
    const rawToken = crypto.randomBytes(32).toString("base64url")
    const claim_token_hash = sha256Hex(rawToken)

    const { seatId, inserted } = await upsertActiveSeat({
      order_id,
      ghl_contact_id,
      purchaser_email: purchaser_email || null,
      seat_email,
      intended_user_name,
      claim_token_hash,
    })

    // Legacy-only mode: stop here (keeps your old intake route alive)
    if (modeAllowsLegacyOnlyShortCircuit()) {
      const claim_url = `https://wrnsignal.workforcereadynow.com/start?claim=${rawToken}`
      return withCorsJson(
        req,
        {
          ok: true,
          accepted: true,
          mode: SIGNAL_ENTRY_MODE,
          seat_id: seatId,
          inserted,
          claim_url,
          note: "legacy_only mode: seat created/rotated; no magic link generated; no GHL field write",
        },
        200
      )
    }

    // New flow (dual/new_only): generate magic link and write it into GHL
    if (!modeAllowsNewFlow()) {
      // Defensive, should never happen
      return withCorsJson(req, { ok: false, error: `invalid SIGNAL_ENTRY_MODE: ${SIGNAL_ENTRY_MODE}` }, 500)
    }

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

    const ghl = await updateGhlMagicLink({ contactId: ghl_contact_id, magicLink: magic_link })

    if (ghl.ok) {
      // Best effort: mark as sent
      try {
        await supabaseAdmin.from("signal_seats").update({ status: "sent" }).eq("id", seatId)
      } catch {}
    }

    // claim_url is just a dev helper / fallback
    const claim_url = `https://wrnsignal.workforcereadynow.com/start?claim=${rawToken}`

    return withCorsJson(
      req,
      {
        ok: true,
        accepted: true,
        mode: SIGNAL_ENTRY_MODE,
        seat_id: seatId,
        inserted,
        claim_url,
        ghl_update_ok: ghl.ok,
        ghl_update_status: ghl.status,
        ghl_update_method: "PUT",
        ghl_update_raw_preview: (ghl.raw || "").slice(0, 500),
      },
      200
    )
  } catch (err: any) {
    // IMPORTANT: return a real failure code so GHL marks it failed and retries appropriately
    return withCorsJson(
      req,
      { ok: false, accepted: false, reason: "server_error", error: err?.message || "server_error" },
      500
    )
  }
}
