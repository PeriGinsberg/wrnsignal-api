// app/api/me/supporters/route.ts
//
// The client's supporters: list them, and invite one.
//
// CLIENT ONLY. A coach cannot invite on a client's behalf in v1, and a coach
// account cannot have supporters of its own. Max 2 live (invited or active),
// held by the slot index in 20261115_client_supporters.sql, so two invites
// racing for the last slot cannot both land.
//
// ONE LOGIN, ONE ROLE. An email that already belongs to a SIGNAL account
// (client or coach) cannot be invited: that login would be both a client and a
// supporter, and every route decides who you are from your profile.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getCallerProfile, getSupabaseAdmin } from "@/lib/collab/identity"
import { featureAllowed } from "@/lib/features"
import { getAppUrl } from "@/lib/urls"
import {
  INVITE_DAYS, MAX_SUPPORTERS, SUPPORTER_PUBLIC_COLUMNS, newInviteToken, normEmail, sendSupporterInvite,
} from "@/lib/supporters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function GET(req: NextRequest) {
  try {
    const me = await getCallerProfile<{ is_coach: boolean | null }>(req, "id, is_coach")
    const supabase = getSupabaseAdmin()

    // Expire lazily: an invite past its date stops holding a slot the next
    // time anyone looks. Accept checks the date itself, so nothing depends on
    // this having run.
    await supabase
      .from("client_supporters")
      .update({ status: "expired", invite_token_hash: null })
      .eq("client_profile_id", me.id)
      .eq("status", "invited")
      .lt("invite_expires_at", new Date().toISOString())

    const { data, error } = await supabase
      .from("client_supporters")
      .select(SUPPORTER_PUBLIC_COLUMNS)
      .eq("client_profile_id", me.id)
      .in("status", ["invited", "active", "expired"])
      .order("created_at", { ascending: true })
    if (error) throw new Error(`Supporters lookup failed: ${error.message}`)

    return withCorsJson(req, {
      ok: true,
      available: !me.is_coach && (await featureAllowed(supabase, "supporters", me.id)),
      max: MAX_SUPPORTERS,
      supporters: data ?? [],
    })
  } catch (err) {
    return routeError(req, err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await getCallerProfile<{ name: string | null; email: string | null; is_coach: boolean | null }>(
      req,
      "id, name, email, is_coach",
    )
    const supabase = getSupabaseAdmin()
    if (me.is_coach) return withCorsJson(req, { ok: false, error: "Coach accounts cannot have supporters." }, 403)
    if (!(await featureAllowed(supabase, "supporters", me.id))) {
      return withCorsJson(req, { ok: false, error: "Supporters are not available on your account." }, 403)
    }

    const body = await req.json().catch(() => null)
    const inviteeEmail = normEmail(body?.email)
    const displayName = String(body?.display_name ?? "").trim().slice(0, 80)
    if (!EMAIL_RE.test(inviteeEmail)) return withCorsJson(req, { ok: false, error: "Enter a valid email address." }, 400)
    if (!displayName) return withCorsJson(req, { ok: false, error: "Enter their name." }, 400)
    if (inviteeEmail === normEmail(me.email)) {
      return withCorsJson(req, { ok: false, error: "That is your own email address." }, 400)
    }

    const { data: account, error: accErr } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", inviteeEmail)
      .limit(1)
    if (accErr) throw new Error(`Account lookup failed: ${accErr.message}`)
    if (account?.length) {
      return withCorsJson(
        req,
        { ok: false, error: "That email already has a SIGNAL account, so it cannot be a supporter. Ask them for a different email." },
        409,
      )
    }

    const { data: live, error: liveErr } = await supabase
      .from("client_supporters")
      .select("slot, email, status, invite_expires_at")
      .eq("client_profile_id", me.id)
      .in("status", ["invited", "active"])
    if (liveErr) throw new Error(`Supporters lookup failed: ${liveErr.message}`)
    const now = Date.now()
    // An invite past its date does not count, but it still holds its slot in
    // the index until it is marked expired, so mark it first.
    const stale = (live ?? []).filter(
      (r: any) => r.status === "invited" && r.invite_expires_at && Date.parse(r.invite_expires_at) < now,
    )
    if (stale.length) {
      await supabase
        .from("client_supporters")
        .update({ status: "expired", invite_token_hash: null })
        .eq("client_profile_id", me.id)
        .eq("status", "invited")
        .lt("invite_expires_at", new Date(now).toISOString())
    }
    const held = (live ?? []).filter((r: any) => !stale.includes(r))
    if (held.some((r: any) => r.email === inviteeEmail)) {
      return withCorsJson(req, { ok: false, error: "You have already invited this person." }, 409)
    }
    const slot = [1, 2].find((s) => !held.some((r: any) => r.slot === s))
    if (!slot) {
      return withCorsJson(
        req,
        { ok: false, error: `You can have ${MAX_SUPPORTERS} supporters. Remove one to invite someone new.` },
        409,
      )
    }

    const { token, hash } = newInviteToken()
    const { data: row, error: insErr } = await supabase
      .from("client_supporters")
      .insert({
        client_profile_id: me.id,
        email: inviteeEmail,
        display_name: displayName,
        slot,
        invited_by_profile_id: me.id,
        invite_token_hash: hash,
        invite_expires_at: new Date(now + INVITE_DAYS * 86_400_000).toISOString(),
      })
      .select(SUPPORTER_PUBLIC_COLUMNS)
      .single()
    if (insErr?.code === "23505") {
      return withCorsJson(req, { ok: false, error: "That slot was just taken. Refresh and try again." }, 409)
    }
    if (insErr || !row) throw new Error(`Supporter invite failed: ${insErr?.message ?? "no row"}`)

    const sent = await sendSupporterInvite({
      to: inviteeEmail,
      supporterName: displayName,
      clientName: String(me.name ?? "").trim() || "Someone you know",
      acceptUrl: `${getAppUrl(req)}/dashboard/supporter/accept?token=${token}`,
      actor: me.id,
    })
    if (sent.ok) {
      await supabase.from("client_supporters").update({ invite_sent_at: new Date().toISOString() }).eq("id", (row as any).id)
    } else {
      console.error("[me/supporters] invite email failed:", sent.error)
    }

    return withCorsJson(req, { ok: true, supporter: row, email_sent: sent.ok }, 201)
  } catch (err) {
    return routeError(req, err)
  }
}
