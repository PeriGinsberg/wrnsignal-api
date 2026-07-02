// app/api/coach/clients/[clientId]/send-invite/route.ts
//
// Send (or re-send) the SIGNAL invite email to an ALREADY-created, linked
// client — the deferred-email half of create-client. [clientId] =
// client_profile_id (distinct from the prospect flow's
// /coach-clients/[id]/send-invite, which is keyed by coach_clients.id and
// creates+links the account; this route does NEITHER).
//
// The account already exists (auth user + profile + active coach_clients link).
// This route ONLY: generates a magic link, emails it, stamps invited_at=now(),
// and writes the audit trail. It never creates an auth user / profile, never
// writes client_profile_id — so it cannot re-create or duplicate anything.
// Re-send-capable: re-calling re-emails + re-stamps invited_at (no 409).
//
// Auth: caller must have FULL access to the client (verifyCoachAccess).

import { type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { sendClientInvite } from "@/lib/email/sendClientInvite"
import { getAppUrl } from "@/lib/urls"
import { logCoachClientEvent } from "../../../../_lib/coachClientEvents"

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
  const { data } = await supabase.from("client_profiles").select("id, user_id").eq("user_id", userId).maybeSingle()
  if (data) return data.id as string
  if (email) {
    const { data: byEmail } = await supabase.from("client_profiles").select("id, user_id").eq("email", email).maybeSingle()
    if (byEmail) {
      if (byEmail.user_id !== userId) {
        await supabase.from("client_profiles").update({ user_id: userId, updated_at: new Date().toISOString() }).eq("id", byEmail.id)
      }
      return byEmail.id as string
    }
  }
  throw new Error("Profile not found")
}

async function verifyCoachAccess(coachProfileId: string, clientProfileId: string, requiredLevel: string, supabase: any) {
  const levels: Record<string, string[]> = {
    view: ["view", "annotate", "full"],
    annotate: ["annotate", "full"],
    full: ["full"],
  }
  const { data } = await supabase
    .from("coach_clients")
    .select("id, access_level, status")
    .eq("coach_profile_id", coachProfileId)
    .eq("client_profile_id", clientProfileId)
    .eq("status", "active")
    .maybeSingle()
  if (!data) return null
  if (!levels[requiredLevel]?.includes(data.access_level)) return null
  return data
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId: clientProfileId } = await params
    const { userId, email } = await getAuthedUser(req)
    const profileId = await getProfileId(userId, email)
    const supabase = getSupabaseAdmin()
    if (!clientProfileId) return withCorsJson(req, { ok: false, error: "clientId is required" }, 400)

    const access = await verifyCoachAccess(profileId, clientProfileId, "full", supabase)
    if (!access) return withCorsJson(req, { ok: false, error: "Forbidden: full access required" }, 403)

    // The account already exists — fetch the client's own fields for the email.
    const { data: client } = await supabase
      .from("client_profiles")
      .select("email, name, target_roles, target_locations, timeline")
      .eq("id", clientProfileId)
      .maybeSingle()
    if (!client?.email) {
      return withCorsJson(req, { ok: false, error: "Client has no email on file" }, 400)
    }
    const clientEmail = String(client.email).trim().toLowerCase()
    const firstName = (String(client.name ?? "").trim().split(/\s+/)[0]) || "there"

    // Coach display name for the email template.
    const { data: coachProf } = await supabase.from("client_profiles").select("name, coach_org").eq("id", profileId).maybeSingle()
    const coachName = coachProf?.name || coachProf?.coach_org || "Your coach"

    // Generate magic link — NON-FATAL.
    let magicLink: string | null = null
    {
      const { data: linkData, error: magicErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: clientEmail,
        options: { redirectTo: `${getAppUrl(req)}/dashboard/welcome` },
      })
      if (magicErr) console.error("[clients/send-invite] generateLink failed:", magicErr.message)
      else magicLink = (linkData as any)?.properties?.action_link ?? null
    }

    // Send email — NON-FATAL.
    let emailSent = false
    if (magicLink) {
      try {
        await sendClientInvite({
          clientFirstName: firstName,
          clientEmail,
          targetRoles: client.target_roles ?? "",
          targetLocations: client.target_locations ?? "",
          timeframe: client.timeline ?? "",
          magicLink,
          coachName,
        })
        emailSent = true
      } catch (emailErr: any) {
        console.error("[clients/send-invite] Email send failed:", emailErr?.message)
      }
    }

    // Stamp the marker: invited_at = now on the caller's coach_clients row.
    const invitedAt = new Date().toISOString()
    const { error: updErr } = await supabase.from("coach_clients").update({ invited_at: invitedAt }).eq("id", access.id)
    if (updErr) throw new Error(`invited_at stamp failed: ${updErr.message}`)

    // Audit trail — NON-FATAL (mirrors the prospect send-invite).
    await logCoachClientEvent({
      coachClientId: access.id,
      eventType: "invite_sent",
      actorProfileId: profileId,
      context: { source: "create-client-deferred" },
    })
    try {
      const { error: noteErr } = await supabase.from("coach_client_notes").insert({
        coach_client_id: access.id,
        coach_profile_id: profileId,
        client_profile_id: clientProfileId,
        type: "other",
        body: "SIGNAL invite sent",
        priority: null,
      })
      if (noteErr) console.warn("[clients/send-invite] System note insert failed:", noteErr.message)
    } catch (noteErr: any) {
      console.warn("[clients/send-invite] System note insert threw:", noteErr?.message)
    }

    return withCorsJson(req, { ok: true, email_sent: emailSent, invited_at: invitedAt }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    return withCorsJson(req, { ok: false, error: msg }, /unauthorized/i.test(msg) ? 401 : 500)
  }
}
