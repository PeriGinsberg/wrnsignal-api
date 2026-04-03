// app/api/applications/[id]/route.ts
import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id }
}

async function getProfileId(userId: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (!data) throw new Error("Profile not found")
  return data.id as string
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuthedUser(req)
    const profileId = await getProfileId(userId)
    const { id: appId } = await params
    const supabase = getSupabaseAdmin()

    // Verify ownership
    const { data: existing, error: lookupErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id")
      .eq("id", appId)
      .maybeSingle()

    if (lookupErr) throw new Error(`Application lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Application not found" }, 404)
    if (existing.profile_id !== profileId) {
      return withCorsJson(req, { error: "Not authorized to modify this application" }, 403)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { error: "Invalid JSON body" }, 400)
    }

    // Strip fields that should not be changed directly
    const { id, profile_id, created_at, ...updates } = body
    updates.updated_at = new Date().toISOString()

    const { data: updated, error: updateErr } = await supabase
      .from("signal_applications")
      .update(updates)
      .eq("id", appId)
      .select("*")
      .single()

    if (updateErr) throw new Error(`Application update failed: ${updateErr.message}`)

    return withCorsJson(req, { ok: true, application: updated })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await getAuthedUser(req)
    const profileId = await getProfileId(userId)
    const { id: appId } = await params
    const supabase = getSupabaseAdmin()

    const { data: existing, error: lookupErr } = await supabase
      .from("signal_applications")
      .select("id, profile_id")
      .eq("id", appId)
      .maybeSingle()

    if (lookupErr) throw new Error(`Application lookup failed: ${lookupErr.message}`)
    if (!existing) return withCorsJson(req, { error: "Application not found" }, 404)
    if (existing.profile_id !== profileId) {
      return withCorsJson(req, { error: "Not authorized to delete this application" }, 403)
    }

    const { error: deleteErr } = await supabase
      .from("signal_applications")
      .delete()
      .eq("id", appId)

    if (deleteErr) throw new Error(`Application delete failed: ${deleteErr.message}`)

    return withCorsJson(req, { ok: true, deleted: appId })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
