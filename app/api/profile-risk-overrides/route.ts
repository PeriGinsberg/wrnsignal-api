import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

const SUPABASE_URL = requireEnv("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY")

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) throw new Error("Unauthorized")
  return m[1]
}

export async function POST(req: Request) {
  try {
    const token = getBearerToken(req)

    // 1) Validate user
    const { data: userData, error: userErr } =
      await supabase.auth.getUser(token)

    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = userData.user.id

    // 2) Parse payload
    const body = await req.json()
    const overrides = body?.overrides

    if (!overrides || typeof overrides !== "object") {
      return NextResponse.json(
        { error: "Invalid overrides payload" },
        { status: 400 }
      )
    }

    // 3) Fetch existing overrides
    const { data: profile, error: profileErr } = await supabase
      .from("client_profiles")
      .select("id, risk_overrides")
      .eq("user_id", userId)
      .maybeSingle()

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      )
    }

    const existing = profile.risk_overrides || {}

    // 4) Merge (new keys overwrite old, others preserved)
    const merged = {
      ...existing,
      ...overrides,
    }

    // 5) Persist
    const { error: updateErr } = await supabase
      .from("client_profiles")
      .update({ risk_overrides: merged })
      .eq("id", profile.id)

    if (updateErr) {
      return NextResponse.json(
        { error: "Failed to save overrides" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Server error" },
      { status: 500 }
    )
  }
}
