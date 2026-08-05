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
//   { application_id, company_id: null }
//                                     UNLINK. Same ownership gate.
//
// The name path is what the post-scan Framer prompt calls, so Framer holds no
// logic that would have to be reimplemented on mobile later.
//
// A LINK MUST BE CORRECTABLE. The suggestion is name-based and the user
// confirms it, so some confirmations will be wrong, and without an unlink the
// mistake is permanent: the migration's ON DELETE SET NULL only fires if the
// company itself is deleted, which is a far bigger act than fixing a mislink.
// Same class as the interview editor that went missing in the tracker rebuild.

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

    // ABSENT AND EXPLICITLY NULL ARE DIFFERENT REQUESTS, and collapsing them
    // with `?? null` would make every link-by-name request read as an unlink.
    // `company_id: null` means unlink; no company_id at all means fall through
    // to company_name.
    const hasCompanyId = Object.prototype.hasOwnProperty.call(body, "company_id")
    const companyId = hasCompanyId
      ? body.company_id === null ? null : String(body.company_id)
      : undefined

    const outcome = await linkApplicationToCompany(supabase, profileId, {
      applicationId: String(body.application_id ?? ""),
      companyId,
      companyName: body.company_name == null ? null : String(body.company_name),
    })

    if (!outcome.ok) {
      return withCorsJson(req, { ok: false, error: outcome.error }, outcome.status)
    }

    return withCorsJson(req, {
      ok: true,
      // Null on an unlink, so the caller can render the empty state without
      // inspecting a flag it might forget to read.
      company: outcome.companyId ? { id: outcome.companyId, name: outcome.companyName } : null,
      // Lets the caller word it correctly: "Added to your board" versus
      // "Linked to Globex". The user pressed one button and deserves to know
      // which of the two happened.
      created: outcome.created,
      unlinked: outcome.unlinked,
    })
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : msg.includes("Profile not found") ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
