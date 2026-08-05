// app/api/network/companies/link-application/route.ts
//
// Link one tracked application to one company on the networking board.
//
// A THIN WRAPPER ON PURPOSE. Auth, then one call, then map an outcome to a
// status. All the decision logic, and specifically the cross-profile ownership
// check the foreign key cannot enforce, lives in
// lib/network-tracker/link-application.ts so it can be driven by a test with a
// fake client. See link-application.test.ts: 31 assertions, five of which
// prove no write is attempted on a rejected request.
//
// Two shapes, one endpoint:
//
//   { application_id, company_id }    the user picked a company from their
//                                     board. Ownership is CHECKED, because the
//                                     FK would accept anyone's company id.
//   { application_id, company_name }  find-or-create by name. Ownership is
//                                     STRUCTURAL: every query pins
//                                     client_profile_id, so a cross-profile
//                                     link is unrepresentable rather than
//                                     rejected.
//
// The name path is what the post-scan Framer prompt calls, so Framer holds no
// logic that would have to be reimplemented on mobile later.
//
// NOT IN THIS ROUTE: unlinking. Nothing here can set company_id back to NULL.
// See the note at the end of the commit message.

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { linkApplicationToCompany } from "../../../../../lib/network-tracker/link-application"

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
  const token = m?.[1]?.trim()
  if (!token) throw new Error("Unauthorized: missing bearer token")
  return token
}

async function getAuthedUser(req: Request) {
  const token = getBearerToken(req)
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user?.id) throw new Error("Unauthorized: invalid token")
  return { userId: data.user.id, email: (data.user.email ?? "").trim().toLowerCase() || null }
}

async function getProfileId(userId: string, email: string | null) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (error) throw new Error(`Profile lookup failed: ${error.message}`)
  if (data) return data.id as string

  if (email) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
    if (emailErr) throw new Error(`Profile email lookup failed: ${emailErr.message}`)
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        const { error: attachErr } = await supabase
          .from("client_profiles")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
        if (attachErr) throw new Error(`Profile attach failed: ${attachErr.message}`)
      }
      return byEmail.id as string
    }
  }
  throw new Error("Profile not found")
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return withCorsJson(req, { ok: false, error: "Invalid JSON body" }, 400)
    }

    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()

    const outcome = await linkApplicationToCompany(supabase, profileId, {
      applicationId: String(body.application_id ?? ""),
      companyId: body.company_id == null ? null : String(body.company_id),
      companyName: body.company_name == null ? null : String(body.company_name),
    })

    if (!outcome.ok) {
      return withCorsJson(req, { ok: false, error: outcome.error }, outcome.status)
    }

    return withCorsJson(req, {
      ok: true,
      company: { id: outcome.companyId, name: outcome.companyName },
      // Lets the caller word it correctly: "Added to your board" versus
      // "Linked to Globex". The user pressed one button and deserves to know
      // which of the two happened.
      created: outcome.created,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : msg.includes("Profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
