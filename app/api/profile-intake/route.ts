// app/api/profile-intake/route.ts
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"
import { getAuthedProfileText } from "../_lib/authProfile"

// ---------- ENV ----------
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

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
function toText(v: any) {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v.trim()
  return String(v).trim()
}

function clampText(v: any, max = 20000) {
  const t = toText(v)
  if (!t) return ""
  return t.length > max ? t.slice(0, max) : t
}

/**
 * We keep the API payload simple and tolerant:
 * - profile_text is required
 * - resume_text is optional (can be same as profile_text)
 * - other fields are optional
 */
export async function POST(req: Request) {
  try {
    // Auth + ownership is enforced here (locked rule)
    const authed: any = await getAuthedProfileText(req)

    // The auth helper’s exact return shape can vary; pull profile + ids safely.
    const profileRow =
      authed?.profile ||
      authed?.client_profile ||
      authed?.clientProfile ||
      authed?.client_profiles ||
      authed

    const client_profile_id =
      profileRow?.id || authed?.client_profile_id || authed?.clientProfileId || null
    const user_id = profileRow?.user_id || authed?.user_id || authed?.userId || null
    const email = profileRow?.email || authed?.email || null

    if (!client_profile_id || !user_id || !email) {
      return withCorsJson(
        req,
        { ok: false, error: "auth_profile_missing", detail: { client_profile_id, user_id, email } },
        500
      )
    }

    const body = await req.json().catch(() => ({} as any))

    // Required core input
    const profile_text = clampText(body.profile_text, 50000)
    if (!profile_text) {
      return withCorsJson(
        req,
        { ok: false, error: "missing_required_fields", required: ["profile_text"] },
        400
      )
    }

    // Optional fields (aligned to your client_profiles schema)
    const name = clampText(body.name, 200)
    const job_type = clampText(body.job_type, 200) // you can use this for "Current student / recent grad / etc"
    const target_roles = clampText(body.target_roles, 2000)
    const target_locations = clampText(body.target_locations, 2000)
    const preferred_locations = clampText(body.preferred_locations, 2000)
    const timeline = clampText(body.timeline, 200)
    const resume_text = clampText(body.resume_text || body.profile_text, 80000)

    // Update the canonical authed profile row (server-side only)
    const { error: upErr } = await supabaseAdmin
      .from("client_profiles")
      .update({
        name: name || null,
        job_type: job_type || null,
        target_roles: target_roles || null,
        target_locations: target_locations || null,
        preferred_locations: preferred_locations || null,
        timeline: timeline || null,
        profile_text,
        resume_text: resume_text || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client_profile_id)
      .eq("user_id", user_id)

    if (upErr) {
      return withCorsJson(req, { ok: false, error: upErr.message }, 400)
    }

    return withCorsJson(
      req,
      {
        ok: true,
        client_profile_id,
      },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
