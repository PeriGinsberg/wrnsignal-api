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
function parseGpa(raw: any): number | null {
  const s = toText(raw).replace(/[^\d.]/g, "")
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  if (n <= 0 || n > 4.5) return null
  return Math.round(n * 100) / 100
}

function gpaBand(gpa: number | null): string {
  if (gpa === null) return "unknown"
  if (gpa >= 3.8) return "3.8_plus"
  if (gpa >= 3.5) return "3.5_3.79"
  return "below_3.5"
}

function splitList(raw: any, max = 12): string[] {
  const s = toText(raw)
  if (!s) return []
  return s
    .split(/[,;\n|]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max)
}


function getBearer(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ""
}

async function resolveProfileIdentity(req: Request) {
  // Locked rule: call auth helper first
  let authed: any = null
  try {
    authed = await getAuthedProfileText(req)
  } catch {
    // we will fall back below
  }

  // Try many plausible shapes
  const profile =
    authed?.profile ||
    authed?.client_profile ||
    authed?.clientProfile ||
    authed?.client_profiles ||
    authed?.clientProfiles ||
    null

  let client_profile_id =
    profile?.id ||
    authed?.client_profile_id ||
    authed?.clientProfileId ||
    authed?.profile_id ||
    null

  let user_id =
    profile?.user_id ||
    authed?.user_id ||
    authed?.userId ||
    authed?.user?.id ||
    authed?.user?.user?.id ||
    null

  let email =
    profile?.email ||
    authed?.email ||
    authed?.user?.email ||
    authed?.user?.user?.email ||
    null

  // If we still don't have identity, decode token via Supabase
  if (!user_id || !email) {
    const token = getBearer(req)
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token)
      if (!error && data?.user) {
        user_id = user_id || data.user.id
        email = email || data.user.email
      }
    }
  }

  // If we have user_id but not profile id, look up client_profiles
  if (user_id && !client_profile_id) {
    const { data, error } = await supabaseAdmin
      .from("client_profiles")
      .select("id, user_id, email")
      .eq("user_id", user_id)
      .single()

    if (!error && data?.id) {
      client_profile_id = data.id
      email = email || data.email
    }
  }

  // As a last resort, look up by email (should still be unique)
  if (email && !client_profile_id) {
    const { data, error } = await supabaseAdmin
      .from("client_profiles")
      .select("id, user_id, email")
      .eq("email", email)
      .single()

    if (!error && data?.id) {
      client_profile_id = data.id
      user_id = user_id || data.user_id
    }
  }

  return { client_profile_id, user_id, email }
}

// ---------- Route ----------
export async function POST(req: Request) {
  try {
    const { client_profile_id, user_id, email } = await resolveProfileIdentity(req)

    if (!client_profile_id || !user_id || !email) {
      return withCorsJson(
        req,
        {
          ok: false,
          error: "auth_profile_missing",
          detail: { client_profile_id, user_id, email },
        },
        500
      )
    }

    const body = await req.json().catch(() => ({} as any))

    // Required core input
    const profile_text = clampText(body.profile_text, 80000)
    if (!profile_text) {
      return withCorsJson(
        req,
        { ok: false, error: "missing_required_fields", required: ["profile_text"] },
        400
      )
    }

    // Optional fields aligned to your client_profiles schema
    const name = clampText(body.name, 200)
    const job_type = clampText(body.job_type, 200)
    const target_roles = clampText(body.target_roles, 4000)
    const target_locations = clampText(body.target_locations, 4000)
    const preferred_locations = clampText(body.preferred_locations, 4000)
    const timeline = clampText(body.timeline, 200)
    const resume_text = clampText(body.resume_text || body.profile_text, 120000)

// ---- structured profile (server-owned; no new user effort) ----
// If you already collect GPA or school elsewhere later, you can add it here.
// For now we only use what exists in the intake payload.
const gpa = parseGpa(body.gpa || body.GPA || body.grade_point_average || null)

const profile_structured = {
  // These may be unknown until you enrich later. That's fine.
  school_tier: toText(body.school_tier) || "unknown",
  gpa,
  gpa_band: gpaBand(gpa),

  // Targets: can come from target_roles text you already store
  targets_raw: target_roles || "",
  target_roles_list: splitList(target_roles, 20),

  // Helpful, but optional
  job_type: job_type || "",
  target_locations_list: splitList(target_locations, 20),
  preferred_locations_list: splitList(preferred_locations, 20),

  // Explicit boundary decisions
  work_auth_assumed: true,
}


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
profile_structured,
        updated_at: new Date().toISOString(),
      })
      .eq("id", client_profile_id)
      .eq("user_id", user_id)

    if (upErr) {
      return withCorsJson(req, { ok: false, error: upErr.message }, 400)
    }

    return withCorsJson(req, { ok: true, client_profile_id }, 200)
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || "server_error" }, 500)
  }
}
