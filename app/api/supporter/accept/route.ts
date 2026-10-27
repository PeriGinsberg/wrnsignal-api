// app/api/supporter/accept/route.ts
//
// The signed-in supporter accepts the invite. POST { token } with a bearer.
//
// Granted only when every check holds:
//   - the token matches a live invite (status 'invited', not past its date)
//   - the login's email IS the invited email, so a forwarded link is useless
//     to anyone else
//   - the plan flag allows supporters for this client
//   - ONE LOGIN, ONE ROLE: the login has no client_profiles row, by login or
//     by email. A client or coach cannot also be a supporter.
//
// The token is cleared on accept. Accepting twice with the same login answers
// ok, so a refresh of the accept page does not show an error.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getAuthedUser, getSupabaseAdmin } from "@/lib/collab/identity"
import { featureAllowed } from "@/lib/features"
import { hashInviteToken, normEmail } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const { userId, email } = await getAuthedUser(req)
    const body = await req.json().catch(() => null)
    const token = String(body?.token ?? "").trim()
    if (!token) return withCorsJson(req, { ok: false, error: "No invite token" }, 400)
    const supabase = getSupabaseAdmin()

    const { data: invite, error } = await supabase
      .from("client_supporters")
      .select("id, client_profile_id, email, status, invite_expires_at")
      .eq("invite_token_hash", hashInviteToken(token))
      .maybeSingle()
    if (error) throw new Error(`Invite lookup failed: ${error.message}`)

    if (!invite) {
      // Already accepted by this login: the token was cleared on the first try.
      const { data: mine } = await supabase
        .from("client_supporters")
        .select("id, client_profile_id")
        .eq("supporter_user_id", userId)
        .eq("status", "active")
        .limit(1)
      if (mine?.length) return withCorsJson(req, { ok: true, client_profile_id: mine[0].client_profile_id })
      return withCorsJson(req, { ok: false, error: "This invite has expired or was cancelled. Ask for a new one." }, 404)
    }
    if (invite.status !== "invited" || !invite.invite_expires_at || Date.parse(invite.invite_expires_at) < Date.now()) {
      return withCorsJson(req, { ok: false, error: "This invite has expired or was cancelled. Ask for a new one." }, 404)
    }
    if (normEmail(email) !== normEmail(invite.email)) {
      return withCorsJson(
        req,
        { ok: false, error: `This invite is for ${invite.email}. Sign in with that email to accept it.` },
        403,
      )
    }
    if (!(await featureAllowed(supabase, "supporters", invite.client_profile_id))) {
      return withCorsJson(req, { ok: false, error: "Supporter access is not available right now." }, 403)
    }

    const [{ data: byLogin, error: e1 }, { data: byEmail, error: e2 }] = await Promise.all([
      supabase.from("client_profiles").select("id").eq("user_id", userId).limit(1),
      supabase.from("client_profiles").select("id").eq("email", normEmail(email)).limit(1),
    ])
    if (e1 || e2) throw new Error(`Account lookup failed: ${(e1 ?? e2)!.message}`)
    if (byLogin?.length || byEmail?.length) {
      return withCorsJson(
        req,
        { ok: false, error: "This email already has a SIGNAL account, so it cannot also be a supporter." },
        409,
      )
    }

    const { data: done, error: updErr } = await supabase
      .from("client_supporters")
      .update({
        status: "active",
        supporter_user_id: userId,
        accepted_at: new Date().toISOString(),
        invite_token_hash: null,
      })
      .eq("id", invite.id)
      .eq("status", "invited")
      .select("id, client_profile_id")
    if (updErr) throw new Error(`Accept failed: ${updErr.message}`)
    if (!done?.length) return withCorsJson(req, { ok: false, error: "This invite was just changed. Ask for a new one." }, 409)

    return withCorsJson(req, { ok: true, client_profile_id: done[0].client_profile_id })
  } catch (err) {
    return routeError(req, err)
  }
}
