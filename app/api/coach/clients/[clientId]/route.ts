// app/api/coach/clients/[clientId]/route.ts
// DELETE — coach removes a client from their roster (sets status to 'revoked')
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  if (!token) throw new Error("Unauthorized: missing bearer token")
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from("client_profiles").select("id").eq("user_id", userId).maybeSingle()
  if (data) return data.id as string
  if (email) {
    const { data: byEmail } = await supabase.from("client_profiles").select("id").eq("email", email).maybeSingle()
    if (byEmail) return byEmail.id as string
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    const { userId, email } = await getAuthedUser(req)
    const coachProfileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    // Verify this coach-client relationship exists and belongs to this coach
    const { data: rel, error: relErr } = await supabase
      .from("coach_clients")
      .select("id, status")
      .eq("coach_profile_id", coachProfileId)
      .eq("client_profile_id", clientId)
      .maybeSingle()

    if (relErr || !rel) return withCorsJson(req, { error: "Client relationship not found" }, 404)
    if (rel.status === "revoked") return withCorsJson(req, { ok: true, message: "Already removed" })

    const { error: updateErr } = await supabase
      .from("coach_clients")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", rel.id)

    if (updateErr) throw new Error(`Remove failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.includes("Unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
