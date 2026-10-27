// app/api/me/supporters/[id]/route.ts
//
// DELETE: the client removes a supporter, or cancels an invite. Effective on
// the supporter's next request: resolveSupporterScope re-reads the row every
// time. Their pending suggestions stay for the client to accept or pass on;
// the supporter can no longer edit them.
//
// POST: resend an invite that is waiting or has expired, with a new token and
// a new 7 days. The old link stops working.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { getCallerProfile, getSupabaseAdmin } from "@/lib/collab/identity"
import { featureAllowed } from "@/lib/features"
import { getAppUrl } from "@/lib/urls"
import { INVITE_DAYS, SUPPORTER_PUBLIC_COLUMNS, newInviteToken, sendSupporterInvite } from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const me = await getCallerProfile(req, "id")
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("client_supporters")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), invite_token_hash: null })
      .eq("id", id)
      .eq("client_profile_id", me.id)
      .in("status", ["invited", "active", "expired"])
      .select(SUPPORTER_PUBLIC_COLUMNS)
    if (error) throw new Error(`Supporter revoke failed: ${error.message}`)
    if (!data?.length) return withCorsJson(req, { ok: false, error: "Supporter not found" }, 404)
    return withCorsJson(req, { ok: true, supporter: data[0] })
  } catch (err) {
    return routeError(req, err)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const me = await getCallerProfile<{ name: string | null }>(req, "id, name")
    const supabase = getSupabaseAdmin()
    if (!(await featureAllowed(supabase, "supporters", me.id))) {
      return withCorsJson(req, { ok: false, error: "Supporters are not available on your account." }, 403)
    }

    const { token, hash } = newInviteToken()
    const { data, error } = await supabase
      .from("client_supporters")
      .update({
        status: "invited",
        invite_token_hash: hash,
        invite_expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
      })
      .eq("id", id)
      .eq("client_profile_id", me.id)
      .in("status", ["invited", "expired"])
      .select(`${SUPPORTER_PUBLIC_COLUMNS}, email`)
    // An expired invite gives its slot up; taking it back fails the slot index
    // if someone new holds it now.
    if (error?.code === "23505") {
      return withCorsJson(req, { ok: false, error: "You already have 2 supporters. Remove one to resend this invite." }, 409)
    }
    if (error) throw new Error(`Invite resend failed: ${error.message}`)
    if (!data?.length) return withCorsJson(req, { ok: false, error: "No invite waiting for this person" }, 404)
    const row = data[0] as any

    const sent = await sendSupporterInvite({
      to: row.email,
      supporterName: row.display_name,
      clientName: String(me.name ?? "").trim() || "Someone you know",
      acceptUrl: `${getAppUrl(req)}/dashboard/supporter/accept?token=${token}`,
      actor: me.id,
    })
    if (sent.ok) {
      await supabase.from("client_supporters").update({ invite_sent_at: new Date().toISOString() }).eq("id", row.id)
    } else {
      console.error("[me/supporters/resend] invite email failed:", sent.error)
    }
    return withCorsJson(req, { ok: true, supporter: row, email_sent: sent.ok })
  } catch (err) {
    return routeError(req, err)
  }
}
