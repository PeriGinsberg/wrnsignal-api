// app/api/supporter/invite/route.ts
//
// The two steps BEFORE the supporter is signed in, both keyed by the emailed
// token (only its SHA-256 is stored):
//
//   GET  ?token=   what the accept page shows: who invited you, as which email
//   POST {token}   email a SIGNAL sign-in link to the INVITED address, which
//                  returns to the accept page signed in. Signing in through
//                  that email is what proves the supporter owns the address.
//
// No bearer token on either: the person may not have a login yet.
// signInWithOtp creates one for them on first use.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { featureAllowed } from "@/lib/features"
import { getAppUrl } from "@/lib/urls"
import { firstName, hashInviteToken } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

async function liveInvite(token: string) {
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("client_supporters")
    .select("id, client_profile_id, email, display_name, status, invite_expires_at")
    .eq("invite_token_hash", hashInviteToken(token))
    .maybeSingle()
  if (error) throw new Error(`Invite lookup failed: ${error.message}`)
  if (!data || data.status !== "invited") return null
  if (!data.invite_expires_at || Date.parse(data.invite_expires_at) < Date.now()) return null
  if (!(await featureAllowed(supabase, "supporters", data.client_profile_id))) return null
  return data
}

const GONE = "This invite has expired or was cancelled. Ask for a new one."

export async function GET(req: NextRequest) {
  try {
    const token = new URL(req.url).searchParams.get("token")?.trim() ?? ""
    const invite = await liveInvite(token)
    if (!invite) return withCorsJson(req, { ok: false, error: GONE }, 404)
    const { data: client } = await getSupabaseAdmin()
      .from("client_profiles")
      .select("name")
      .eq("id", invite.client_profile_id)
      .maybeSingle()
    return withCorsJson(req, {
      ok: true,
      invite: {
        email: invite.email,
        display_name: invite.display_name,
        client_first_name: firstName(client?.name, "Your contact"),
      },
    })
  } catch (err) {
    return routeError(req, err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const token = String(body?.token ?? "").trim()
    const invite = await liveInvite(token)
    if (!invite) return withCorsJson(req, { ok: false, error: GONE }, 404)

    const { error } = await getSupabaseAdmin().auth.signInWithOtp({
      email: invite.email,
      options: { emailRedirectTo: `${getAppUrl(req)}/dashboard/supporter/accept?token=${encodeURIComponent(token)}` },
    })
    if (error) throw new Error(`Sign-in link failed: ${error.message}`)
    return withCorsJson(req, { ok: true, sent_to: invite.email })
  } catch (err) {
    return routeError(req, err)
  }
}
